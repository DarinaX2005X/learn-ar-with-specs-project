"""Independent admission/acoustic regressions. Never writes real audio files."""
from pathlib import Path
import argparse,tempfile,shutil,json
import numpy as np
from verify_tablekit_audio import validate_audio,read_pcm,validate_legacy,validate_museum

def rejected(call,message):
    try:call()
    except (ValueError,FileNotFoundError):return
    raise AssertionError(message)

def main(directory):
    validate_audio(directory)
    # The legacy stereo cloth's genuine .332 peak must not receive mono/.30 limits.
    cloth=read_pcm(directory/'cloth.wav');validate_legacy('cloth',cloth)
    require_stereo=cloth.copy();require_stereo['channels']=1
    rejected(lambda:validate_legacy('cloth',require_stereo),'legacy stereo must remain stereo')
    new=read_pcm(directory/'museum_pin_01.wav');validate_museum('museum_pin_01',new)
    hot=new.copy();hot['samples']=new['samples']*2
    rejected(lambda:validate_museum('museum_pin_01',hot),'new .40 peak must fail even though legacy permits <.5')
    silent=new.copy();silent['samples']=np.zeros_like(new['samples'])
    rejected(lambda:validate_museum('museum_pin_01',silent),'silent replacement must fail independently of hashes')
    dc=new.copy();dc['samples']=new['samples']+.003
    rejected(lambda:validate_museum('museum_pin_01',dc),'new DC offset must fail')
    end=new.copy();end['samples']=new['samples'].copy();end['samples'][-1]=.002
    rejected(lambda:validate_museum('museum_pin_01',end),'new endpoint click must fail')
    with tempfile.TemporaryDirectory(prefix='tablekit-audio-negative-') as temporary:
        folder=Path(temporary)
        for p in directory.iterdir():
            if p.suffix.lower() in ('.wav','.json'):shutil.copyfile(p,folder/p.name)
        (folder/'extra.wav').write_bytes((folder/'engage.wav').read_bytes())
        rejected(lambda:validate_audio(folder),'unexpected WAV must fail strict 13')
        (folder/'extra.wav').unlink();missing=folder/'museum_pin_02.wav';saved=missing.read_bytes();missing.unlink()
        rejected(lambda:validate_audio(folder),'missing new clip must fail')
        missing.write_bytes(saved);missing=folder/'latch.wav';saved=missing.read_bytes();missing.unlink()
        rejected(lambda:validate_audio(folder),'missing legacy clip must fail')
        missing.write_bytes(saved)
        # Correct-format, numerically valid different audio still cannot change frozen bytes.
        target=folder/'museum_pin_02.wav';target.write_bytes((folder/'museum_pin_01.wav').read_bytes())
        rejected(lambda:validate_audio(folder),'acoustically valid replacement must fail frozen SHA')
    print('PASS audio negative checks: strict extra/missing, legacy stereo, independent museum peak/DC/silence/endpoint, frozen-byte replacement')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--audio-directory',type=Path,default=Path(__file__).resolve().parents[2]/'Assets/Audio/TableKit');a=p.parse_args();main(a.audio_directory)
