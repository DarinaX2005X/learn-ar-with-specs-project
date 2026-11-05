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
    "ExhibitionScreen",
    "ExhibitionScreenShort",
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
    f"Expected 18 TableKit models; missing={expected_models-found_models}; unexpected={found_models-expected_models}",
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
    len(manifest["resources"]) == 18 and set(records) == expected_models,
    "Manifest must list all 18 models exactly once",
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

    parents = {
        child: index
        for index, node in enumerate(d["nodes"])
        for child in node.get("children", [])
    }

    def world_matrix(index):
        node = d["nodes"][index]
        x, y, z, w = node.get("rotation", [0, 0, 0, 1])
        matrix = np.eye(4)
        matrix[:3, :3] = np.array(
            [
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
            ]
        ) @ np.diag(node.get("scale", [1, 1, 1]))
        matrix[:3, 3] = node.get("translation", [0, 0, 0])
        return world_matrix(parents[index]) @ matrix if index in parents else matrix

    require(bool(d.get("meshes")), file.name + ": no renderable meshes")
    count = 0
    building_triangles = []
    screen_positions = []
    anonymous_points = []
    for mesh_index, m in enumerate(d["meshes"]):
        for p in m["primitives"]:
            v = access(p["attributes"]["POSITION"])
            if file.stem.startswith("ExhibitionScreen"):
                screen_positions.extend(v)
            n = access(p["attributes"]["NORMAL"])
            ix = access(p["indices"]).reshape(-1, 3)
            if "TEXCOORD_0" in p["attributes"]:
                uv = access(p["attributes"]["TEXCOORD_0"])
                require(
                    len(uv) == len(v) and np.isfinite(uv).all(),
                    file.name + ": UV count/values are invalid",
                )
            if file.stem == "AnonymousTrack":
                node_index = next(
                    index
                    for index, node in enumerate(d["nodes"])
                    if node.get("mesh") == mesh_index
                )
                matrix = world_matrix(node_index)
                anonymous_points.extend(v @ matrix[:3, :3].T + matrix[:3, 3])
            if file.stem == "MuseumBuilding":
                scene_node = next(
                    index
                    for index, node in enumerate(d["nodes"])
                    if node.get("mesh") == mesh_index
                )
                matrix = world_matrix(scene_node)
                world_vertices = v @ matrix[:3, :3].T + matrix[:3, 3]
                building_triangles.extend(world_vertices[ix])
                if m["name"] == "WorkshopFurniture__leather":
                    require(
                        v[:, 1].max() < 1.08,
                        "MuseumBuilding: obsolete baked static lid remains in the stationery batch",
                    )
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
    if screen_positions:
        positions = np.asarray(screen_positions)
        width = 2.4 if file.stem == "ExhibitionScreen" else 1.25
        require(
            np.allclose(positions.min(axis=0), [-width / 2, 0, -0.075], atol=1e-6),
            file.name + ": screen exceeds authoritative minimum bounds",
        )
        require(
            np.allclose(positions.max(axis=0), [width / 2, 2, 0.075], atol=1e-6),
            file.name + ": screen exceeds authoritative maximum bounds",
        )
        require(
            any("BotanicalSpecimens" in name for name in names),
            file.name + ": reversible exhibit geometry missing",
        )
    teal = next(material for material in d["materials"] if material["name"] == "teal")
    require(
        np.allclose(
            teal["pbrMetallicRoughness"]["baseColorFactor"][:3],
            [0.008023193, 0.045186204, 0.042311410],
            atol=1e-6,
        ),
        file.name + ": teal material factor must use linear RGB, not raw sRGB",
    )
    if file.stem == "AnonymousTrack":
        by_name = {node["name"]: node for node in d["nodes"]}
        root_name = d["nodes"][d["scenes"][d.get("scene", 0)]["nodes"][0]]["name"]
        expected = {
            "Head": ([0, 12.8, 0], root_name),
            "Hip_L": ([-0.72, 6.3, 0], root_name),
            "Hip_R": ([0.72, 6.3, 0], root_name),
            "Knee_L": ([0, -2.7, 0], "Hip_L"),
            "Knee_R": ([0, -2.7, 0], "Hip_R"),
            "Shoulder_L": ([-1.75, 9.95, 0], root_name),
            "Shoulder_R": ([1.75, 9.95, 0], root_name),
            "Forearm_L": ([-0.33, -2.3, 0], "Shoulder_L"),
            "Forearm_R": ([0.33, -2.3, 0], "Shoulder_R"),
            "Hand_L": ([0, -1.92, 0], "Forearm_L"),
            "Hand_R": ([0, -1.92, 0], "Forearm_R"),
        }
        for name, (position, parent_name) in expected.items():
            node = by_name[name]
            index = next(i for i, item in enumerate(d["nodes"]) if item is node)
            require(
                np.allclose(
                    node["translation"], np.asarray(position) * 0.007, atol=1e-12
                ),
                file.name + ": skeletal bind translation changed for " + name,
            )
            require(
                d["nodes"][parents[index]]["name"] == parent_name,
                file.name + ": skeletal parent changed for " + name,
            )
            require(
                np.allclose(node.get("rotation", [0, 0, 0, 1]), [0, 0, 0, 1]),
                file.name + ": neutral bind rotation changed for " + name,
            )
        points = np.asarray(anonymous_points)
        require(
            np.allclose(points.min(axis=0), [-0.01765151, 0, -0.010675], atol=1e-8)
            and np.allclose(
                points.max(axis=0), [0.01765151, 0.10255, 0.00595], atol=1e-8
            ),
            file.name + ": neutral figure functional envelope changed",
        )
        forbidden = [
            "RoleMark",
            "Badge",
            "Satchel",
            "CapBand",
            "WidePeakedCap",
            "Apron",
            "Spectacles",
            "Moustache",
            "Courier",
            "Guard",
            "Conservator",
        ]
        require(
            not any(word in node["name"] for node in d["nodes"] for word in forbidden),
            file.name + ": neutral track figure contains a role-specific identifier",
        )
        require(
            "BlankHead" not in by_name and "NeutralTorso" not in by_name,
            file.name + ": obsolete debug mannequin geometry remains",
        )
        neutral = d["asset"]["extras"].get("tableKit", {})
        require(
            neutral.get("sameTemplateForEveryTrack")
            and neutral.get("roleAccessories") is False,
            file.name + ": neutral reconstruction contract missing",
        )
        require(
            len(d.get("images", [])) == 1
            and d["images"][0].get("mimeType") == "image/jpeg"
            and "uri" not in d["images"][0],
            file.name + ": original timber grain must be embedded",
        )
    if file.stem == "MuseumBuilding":
        by_name = {node["name"]: node for node in d["nodes"]}
        require(
            "CaseLidPivot" in by_name and "CaseLidSurface" in by_name,
            "MuseumBuilding: genuine articulated lid nodes missing",
        )
        require(
            np.allclose(by_name["CaseLidPivot"]["translation"], [-3.725, 1.035, 3.65]),
            "MuseumBuilding: folio hinge does not match the real base",
        )
        require(
            np.allclose(by_name["CaseLidSurface"]["translation"], [0.225, 0.0125, 0]),
            "MuseumBuilding: lid interaction origin must be its real surface centre",
        )
        require(
            np.allclose(
                by_name["CaseLidPivot"]["rotation"],
                [0, 0, np.sin(np.deg2rad(75) / 2), np.cos(np.deg2rad(75) / 2)],
            ),
            "MuseumBuilding: default folio must open around Z by 75 degrees",
        )
        for degrees in range(76):
            angle = np.deg2rad(degrees)
            # All closed/open cover corners stay above the original paper and ink.
            corners = np.array(
                [
                    [x, y, z]
                    for x in [0, 0.45]
                    for y in [0, 0.025]
                    for z in [-0.16, 0.16]
                ]
            )
            rotation = np.array(
                [
                    [np.cos(angle), -np.sin(angle), 0],
                    [np.sin(angle), np.cos(angle), 0],
                    [0, 0, 1],
                ]
            )
            posed = corners @ rotation.T + np.array([-3.725, 1.035, 3.65])
            require(
                posed[:, 1].min() > 1.0335,
                "MuseumBuilding: moving lid intersects the case ink",
            )
        anchor_nodes = {
            node["name"]: node
            for node in d["nodes"]
            if node["name"].startswith("Anchor_")
        }
        require(
            np.allclose(
                anchor_nodes["Anchor_EntryRecording"]["translation"],
                [4.25, 1.155, -1.695],
            ),
            "MuseumBuilding: entry recording anchor position is wrong",
        )
        require(
            np.allclose(
                anchor_nodes["Anchor_EntryRecording"]["rotation"],
                [0, np.cos(np.pi / 20), np.sin(np.pi / 20), 0],
            ),
            "MuseumBuilding: entry recording must face the viewer and lean upward 18 degrees",
        )
        require(
            np.allclose(
                anchor_nodes["Anchor_PinGlass"]["translation"], [-3.53, 1.026, 3.26]
            ),
            "MuseumBuilding: workshop recording is not centred on the real loupe",
        )
        require(
            "rotation" not in anchor_nodes["Anchor_PinGlass"],
            "MuseumBuilding: workshop anchor must remain identity; renderer supplies the horizontal tilt",
        )
        require(
            np.allclose(
                anchor_nodes["Anchor_EntryClock"]["translation"], [3.6, 1.15, -1.15]
            ),
            "MuseumBuilding: existing clock control anchor changed",
        )
        require(
            np.allclose(
                anchor_nodes["Anchor_FileRack"]["translation"], [3.95, 1.042, -1.30]
            ),
            "MuseumBuilding: staging file anchor must stay on the exposed left folder top",
        )
        require(
            np.allclose(
                anchor_nodes["Anchor_ReceptionLamp_Desk"]["translation"],
                [4.42, 1.425, -1.31],
            )
            and np.allclose(
                anchor_nodes["Anchor_ReceptionLamp_Picture"]["translation"],
                [6.43, 2.51, -2.8],
            ),
            "MuseumBuilding: desk light must follow the counter while the wall picture light stays fixed",
        )
        require(
            {"Anchor_EntryPinClip", "Anchor_PinHandle"} <= set(anchor_nodes),
            "MuseumBuilding: tactile pin targets missing",
        )
        require(
            np.hypot(0.16 / 2, 0.08 / 2) < 0.105,
            "MuseumBuilding: workshop optical crop does not fit the clear 21 cm loupe",
        )
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


# Native vitrine contract: contact is the gemstone bottom, never its centre.
def vitrine_geometry(filename):
    blob = (models / filename).read_bytes()
    json_length = struct.unpack_from("<I", blob, 12)[0]
    document = json.loads(blob[20 : 20 + json_length])
    binary = blob[28 + json_length :]

    def values(index):
        accessor = document["accessors"][index]
        view = document["bufferViews"][accessor["bufferView"]]
        width = {"SCALAR": 1, "VEC3": 3}[accessor["type"]]
        dtype = {5126: "<f4", 5125: "<u4"}[accessor["componentType"]]
        return np.frombuffer(binary, dtype=dtype, count=accessor["count"] * width,
                             offset=view["byteOffset"]).reshape(-1, width)

    opaque = []
    for node in document["nodes"]:
        if "mesh" not in node:
            continue
        for primitive in document["meshes"][node["mesh"]]["primitives"]:
            material = document["materials"][primitive["material"]]
            if material.get("alphaMode") == "BLEND":
                continue
            vertices = values(primitive["attributes"]["POSITION"])
            indices = values(primitive["indices"]).reshape(-1, 3)
            opaque.append((node["name"], vertices[indices]))
    return document, opaque


case_document, case_parts = vitrine_geometry("DisplayCase.glb")
contract = case_document["asset"]["extras"]["tableKit"]
require(contract["nativeModelScale"] == [65, 98.0392, 65], "Case native scale changed")
case_scale = np.array([65, 98.0392, 65]) / 6
case_nodes = {node["name"]: node for node in case_document["nodes"]}
contact = np.array(case_nodes["SocketContact"]["translation"]) * case_scale
require(np.allclose(contact, [0, 1, 0], atol=1e-6), "Gem bottom must meet the exact 100cm socket")
require(contract["clocheAlwaysRaised"], "All cases need universal access without hidden actor orientation")
require(not any(name.startswith(("GlassSide_", "GlassFront_", "GlassTop")) for name in case_nodes),
        "Sealed lower panes obstruct physical pickup")


def first_surface(start, finish):
    direction = finish - start
    hits = []
    for name, triangles in case_parts:
        for triangle in triangles * case_scale:
            edge1, edge2 = triangle[1] - triangle[0], triangle[2] - triangle[0]
            p = np.cross(direction, edge2)
            determinant = np.dot(edge1, p)
            if abs(determinant) < 1e-12:
                continue
            inverse = 1 / determinant
            offset = start - triangle[0]
            u = np.dot(offset, p) * inverse
            q = np.cross(offset, edge1)
            v = np.dot(direction, q) * inverse
            t = np.dot(edge2, q) * inverse
            if u >= -1e-8 and v >= -1e-8 and u + v <= 1 + 1e-8 and 0 <= t <= 1:
                hits.append((t, name, start + t * direction))
    return min(hits, key=lambda hit: hit[0]) if hits else None


floor_hit = first_surface(np.array([0., 1.15, 0.]), np.array([0., .95, 0.]))
require(floor_hit is not None and floor_hit[1] == "SocketWellFloor"
        and abs(floor_hit[2][1] - 1) < 1e-6, "Socket is capped instead of genuinely hollow")
for x, z in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
    require(first_surface(np.array([x * .4, 1.10, z * .4]), np.array([0., 1.10, 0.])) is None,
            "Raised cloche must admit a hand from all four cardinal directions")

gem_document, gem_parts = vitrine_geometry("Ruby.glb")
gem_vertices = np.concatenate([triangles.reshape(-1, 3) for _, triangles in gem_parts]) * (100 / 6)
require(np.allclose(np.ptp(gem_vertices, axis=0), [.11, .0635, .09], atol=1e-6),
        "Ruby must remain handheld: 11 by 6.35 by 9cm")
require(abs(gem_vertices[:, 1].min()) < 1e-9, "Ruby bottom pivot changed")
print("PASS hollow socket exact contact, universal raised access and handheld gem")
