"""Strict 13-file admission, immutable release bytes, independent family limits.
No synthesis, writes or machine-specific paths. Metadata is not an allow-list.
"""
from pathlib import Path
import hashlib,json,wave,math
import numpy as np

LEGACY=frozenset({'cloth','engage','latch'})
MUSEUM=frozenset({'museum_pin_01','museum_pin_02','museum_clock_01','museum_clock_02',
    'museum_paper_01','museum_paper_02','museum_cloth','museum_glass','museum_latch','museum_stamp'})
EXPECTED=LEGACY|MUSEUM
def require(ok,message):
    if not ok:raise ValueError(message)

def read_pcm(path):
    with wave.open(str(path),'rb') as w:
        channels,rate,width,frames=w.getnchannels(),w.getframerate(),w.getsampwidth(),w.getnframes()
        require(w.getcomptype()=='NONE' and rate==44100 and width==2,path.name+': expected uncompressed 44.1kHz 16-bit PCM')
        require(channels in (1,2) and frames>0,path.name+': invalid channels/empty samples')
        raw=w.readframes(frames)
    require(len(raw)==frames*channels*width,path.name+': truncated sample data')
    samples=np.frombuffer(raw,dtype='<i2').astype(float)/32768
    require(np.isfinite(samples).all(),path.name+': nonfinite samples')
    return {'channels':channels,'sampleRate':rate,'sampleWidth':width,'frames':frames,'samples':samples}

def validate_legacy(name,pcm):
    require(name in LEGACY,'Not an original legacy clip')
    a=pcm['samples'];channels=2 if name=='cloth' else 1
    require(pcm['channels']==channels,name+': original legacy channel layout changed')
    # Preserve the original verifier's independent legacy limits exactly.
    require(np.max(abs(a))<.5 and abs(a.mean())<.01,name+': legacy peak/DC exceeds .5/.01')
    require(np.max(abs(a[-min(100,len(a)):]))<.025,name+': legacy tail exceeds .025')

def validate_museum(name,pcm):
    require(name in MUSEUM,'Not an approved museum clip')
    a=pcm['samples']
    require(pcm['channels']==1,name+': museum mechanism clip must be mono')
    require(2000<pcm['frames']<=22050,name+': museum duration outside (45ms,500ms]')
    require(.01<np.max(abs(a))<.30 and abs(a.mean())<.002,name+': museum peak/DC exceeds (.01,.30)/.002')
    require(.001<float(np.sqrt(np.mean(a*a)))<.1,name+': museum RMS outside (.001,.1)')
    require(abs(a[0])<.005 and abs(a[-1])<.001,name+': museum endpoint click')
    require(np.max(abs(a[-100:]))<.005,name+': museum tail is not faded')

def validate_audio(directory):
    directory=Path(directory);wavs=[p for p in directory.iterdir() if p.is_file() and p.suffix.lower()=='.wav'] if directory.is_dir() else [];found={p.stem for p in wavs}
    require(len(wavs)==13 and found==EXPECTED,f'Expected exactly 13 TableKit WAVs; missing={EXPECTED-found}; unexpected={found-EXPECTED}')
    contract=json.loads((directory/'tablekit-audio-contract.json').read_text(encoding='utf-8'))
    rows=contract['resources'];records={r['name']:r for r in rows}
    require(len(rows)==13 and set(records)==EXPECTED,'Frozen audio contract must list all 13 exactly once')
    source=json.loads((directory/'museum-audio-manifest.json').read_text(encoding='utf-8'))
    entries=source['resources'];original={r['name']:r for r in entries}
    require(len(entries)==10 and set(original)==MUSEUM,'Original synthesis manifest must list the fixed ten museum clips exactly once')
    result=[]
    for name in sorted(EXPECTED):
        path=directory/(name+'.wav');pcm=read_pcm(path);a=pcm['samples'];frozen=records[name]
        (validate_legacy if name in LEGACY else validate_museum)(name,pcm)
        require(path.stat().st_size==frozen['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest()==frozen['sha256'],name+': frozen release WAV bytes/hash changed; do not silently rebaseline')
        for key in ['channels','sampleRate','sampleWidth','frames']:require(pcm[key]==frozen[key],name+': frozen '+key+' changed')
        if name in MUSEUM:
            r=original[name]
            require(r['bytes']==path.stat().st_size and r['channels']==1 and r['sampleRate']==44100,name+': original synthesis metadata changed')
            require(abs(r['duration']-pcm['frames']/44100)<1/44100,name+': original duration mismatch')
            require(abs(r['peak']-float(abs(a).max()))<=1/32768+1e-9,name+': original peak mismatch beyond one PCM quantization step')
        result.append({'name':name,'channels':pcm['channels'],'duration':pcm['frames']/44100,'peak':float(abs(a).max()),'rms':float(np.sqrt(np.mean(a*a)))})
    for family in ['pin','clock','paper']:
        require(records['museum_'+family+'_01']['sha256']!=records['museum_'+family+'_02']['sha256'],family+': two sibling variants must differ')
    print('PASS strict 13 WAVs: 3 original legacy layouts/limits + 10 mono museum limits; all release bytes/hashes and original synthesis metadata verified')
    return result

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--audio-directory',type=Path,default=Path(__file__).resolve().parents[2]/'Assets/Audio/TableKit');args=parser.parse_args()
    validate_audio(args.audio_directory)
