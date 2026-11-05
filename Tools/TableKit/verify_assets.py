# Run the full suite: python Tools/TableKit/test_tablekit.py
# Empty or incomplete asset directories are failures, not a successful no-op.
def require(condition, message):
    if not condition:
        raise ValueError(message)


"""Validate all shipped GLB buffers, indices, normals, joint anchors and WAV samples."""
from pathlib import Path
import struct, json, wave
import numpy as np

root = Path(__file__).resolve().parents[2]
models = root / "Assets" / "Art" / "TableKit"
expected_models = {
    "MuseumBuilding",
    "Guard",
    "Courier",
    "Conservator",
    "AnonymousTrack",
    "Camera",
    "Curtain",
    "DisplayCase",
    "MirrorHousing",
    "MuseumWall",
    "Plinth",
    "Ruby",
    "RoleMarkAnonymous",
    "RoleMarkGuard",
    "RoleMarkCourier",
    "RoleMarkConservator",
}
found_models = {file.stem for file in models.glob("*.glb")}
require(
    found_models == expected_models,
    f"Expected 16 TableKit models; missing={expected_models-found_models}; unexpected={found_models-expected_models}",
)
audio_directory = root / "Assets" / "Audio" / "TableKit"
expected_audio = {"cloth", "engage", "latch"}
found_audio = {file.stem for file in audio_directory.glob("*.wav")}
require(
    found_audio == expected_audio,
    f"Expected 3 TableKit WAVs; missing={expected_audio-found_audio}; unexpected={found_audio-expected_audio}",
)
manifest = json.loads((models / "manifest.json").read_text(encoding="utf-8"))
records = {record["name"]: record for record in manifest["resources"]}
require(
    len(manifest["resources"]) == 16 and set(records) == expected_models,
    "Manifest must list all 16 models exactly once",
)

for file in models.glob("*.glb"):
    b = file.read_bytes()
    require(len(b) >= 28, file.name + ": GLB is empty or missing chunk headers")
    (magic, version, length) = struct.unpack_from("<III", b)
    require(
        magic == 0x46546C67 and version == 2 and (length == len(b)),
        file.name + ": expected glTF 2.0 binary header and matching file length",
    )
    (jl, jtype) = struct.unpack_from("<II", b, 12)
    require(jtype == 0x4E4F534A, file.name + ": first binary chunk must contain JSON")
    d = json.loads(b[20 : 20 + jl])
    offset = 20 + jl
    (bl, btype) = struct.unpack_from("<II", b, offset)
    require(
        btype == 0x004E4942,
        file.name + ": second binary chunk must contain buffer data",
    )
    data = b[offset + 8 :]
    require(
        len(data) == bl,
        file.name + ": declared buffer length does not match buffer data",
    )

    def access(i):
        a = d["accessors"][i]
        v = d["bufferViews"][a["bufferView"]]
        count = a["count"]
        require(count > 0, file.name + ": mesh accessor is empty")
        n = {"VEC3": 3, "VEC2": 2, "SCALAR": 1}[a["type"]]
        dtype = {5126: "<f4", 5125: "<u4"}[a["componentType"]]
        require(
            v["byteOffset"] + v["byteLength"] <= len(data),
            file.name + ": accessor extends beyond the binary buffer",
        )
        return np.frombuffer(
            data, dtype=dtype, count=count * n, offset=v["byteOffset"]
        ).reshape(count, n)

    require(bool(d.get("meshes")), file.name + ": no renderable meshes")
    count = 0
    building_triangles = []
    for m in d["meshes"]:
        for p in m["primitives"]:
            v = access(p["attributes"]["POSITION"])
            n = access(p["attributes"]["NORMAL"])
            ix = access(p["indices"]).reshape(-1, 3)
            if "TEXCOORD_0" in p["attributes"]:
                uv = access(p["attributes"]["TEXCOORD_0"])
                require(
                    len(uv) == len(v) and np.isfinite(uv).all(),
                    file.name + ": UV count/values are invalid",
                )
            if file.stem == "MuseumBuilding":
                building_triangles.extend(v[ix])
            require(
                np.isfinite(v).all() and np.isfinite(n).all(),
                file.name + ": mesh contains non-finite positions or normals",
            )
            require(
                ix.max() < len(v),
                file.name + ": triangle index is outside the vertex array",
            )
            require(
                np.max(abs(np.linalg.norm(n, axis=1) - 1)) < 1e-05,
                file.name + ": mesh normals must have unit length",
            )
            face = np.cross(v[ix[:, 1]] - v[ix[:, 0]], v[ix[:, 2]] - v[ix[:, 0]])
            require(
                (np.sum(face * n[ix[:, 0]], axis=1) > 0).all(),
                file.name + ": normal/winding disagreement",
            )
            count += len(ix)
    names = {n["name"] for n in d["nodes"]}
    teal = next(material for material in d["materials"] if material["name"] == "teal")
    require(
        np.allclose(
            teal["pbrMetallicRoughness"]["baseColorFactor"][:3],
            [0.008023193, 0.045186204, 0.042311410],
            atol=1e-6,
        ),
        file.name + ": teal material factor must use linear RGB, not raw sRGB",
    )
    if file.stem == "MuseumBuilding":
        require(
            {
                "Anchor_Entrance",
                "Anchor_RubyHall",
                "Anchor_Workshop",
                "Anchor_Archive",
                "Anchor_ConservationBench",
            }
            <= names,
            "MuseumBuilding: missing room/interaction anchors",
        )
        require(
            len(d.get("images", [])) == 4,
            "MuseumBuilding: four original JPEG images must be embedded",
        )
        for image in d["images"]:
            require(
                "uri" not in image and image.get("mimeType") == "image/jpeg",
                "MuseumBuilding: textures must use embedded JPEG bufferViews",
            )
            view = d["bufferViews"][image["bufferView"]]
            payload = data[view["byteOffset"] : view["byteOffset"] + view["byteLength"]]
            require(
                payload.startswith(b"\xff\xd8") and payload.endswith(b"\xff\xd9"),
                "MuseumBuilding: embedded JPEG payload invalid",
            )
        triangles = np.asarray(building_triangles)

        def blocked(start, end):
            start = np.asarray(start)
            direction = np.asarray(end) - start
            edge1 = triangles[:, 1] - triangles[:, 0]
            edge2 = triangles[:, 2] - triangles[:, 0]
            h = np.cross(np.broadcast_to(direction, edge2.shape), edge2)
            det = np.sum(edge1 * h, axis=1)
            valid = abs(det) > 1e-9
            inverse = np.zeros_like(det)
            inverse[valid] = 1 / det[valid]
            s = start - triangles[:, 0]
            u = np.sum(s * h, axis=1) * inverse
            q = np.cross(s, edge1)
            v = np.sum(direction * q, axis=1) * inverse
            t = np.sum(edge2 * q, axis=1) * inverse
            return bool(
                np.any(
                    valid
                    & (u >= -1e-7)
                    & (v >= -1e-7)
                    & (u + v <= 1 + 1e-7)
                    & (t > 1e-6)
                    & (t < 1 - 1e-6)
                )
            )

        passages = [
            ((3.5, 1.65, -5.5), (3.5, 1.65, -4.5)),
            ((3.5, 1.65, -0.6), (3.5, 1.65, 0.6)),
            ((-0.6, 1.65, 2.5), (0.6, 1.65, 2.5)),
            ((-0.6, 1.65, -2.5), (0.6, 1.65, -2.5)),
            ((-2.5, 1.65, -0.6), (-2.5, 1.65, 0.6)),
        ]
        for start, end in passages:
            require(
                not blocked(start, end),
                f"MuseumBuilding: doorway is physically blocked at {start} -> {end}",
            )
        require(
            blocked((1, 1.65, -0.6), (1, 1.65, 0.6)),
            "MuseumBuilding: masonry beside the door must remain closed",
        )
        print(
            "MuseumBuilding: five genuine open passages, four embedded images, linear factors and UVs verified"
        )
    if file.stem in ["Guard", "Courier", "Conservator"]:
        require(
            {
                "Head",
                "Shoulder_L",
                "Shoulder_R",
                "Forearm_L",
                "Forearm_R",
                "Hand_L",
                "Hand_R",
                "RoleMark",
            }
            <= names,
            file.name
            + ": {'Head','Shoulder_L','Shoulder_R','Forearm_L','Forearm_R','Hand_L','Hand_R','RoleMark'}<=names",
        )
    require(
        records[file.stem]["bytes"] == file.stat().st_size,
        file.name + ": manifest byte count differs",
    )
    require(
        records[file.stem]["triangles"] == count,
        file.name + ": manifest triangle count differs",
    )
    print(file.name, "VALID", count, "triangles")
for file in (root / "Assets" / "Audio" / "TableKit").glob("*.wav"):
    with wave.open(str(file), "rb") as wav:
        require(
            wav.getframerate() == 44100 and wav.getsampwidth() == 2,
            file.name + ": WAV must be 44.1 kHz 16-bit PCM",
        )
        require(wav.getnframes() > 0, file.name + ": WAV has no samples")
        a = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2") / 32768
        require(
            np.max(abs(a)) < 0.5 and abs(a.mean()) < 0.01,
            file.name + ": WAV exceeds peak headroom or DC offset limits",
        )
        require(
            np.max(abs(a[-min(100, len(a)) :])) < 0.025,
            file.name + ": WAV tail is not faded sufficiently",
        )
        print(
            file.name,
            "VALID",
            "peak",
            round(float(np.max(abs(a))), 4),
            "DC",
            round(float(a.mean()), 6),
        )
