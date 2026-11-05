"""Run from a fresh clone: python Tools/TableKit/test_tablekit.py

Requires Python 3.10+, numpy, Node.js and npm. The first run downloads the pinned
TypeScript 5.9.3 compiler into npm's cache. Compilation goes into os.tmpdir and is
removed on exit. Tests never regenerate models or write inside Assets.
"""

from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import ast
import struct

TOOLS = Path(__file__).resolve().parent
PROJECT = TOOLS.parents[1]
COMPILER = "typescript@5.9.3"


def run(command, **kwargs):
    print("RUN", " ".join(map(str, command)), flush=True)
    subprocess.run(command, check=True, **kwargs)


def main():
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    node = shutil.which("node")
    if not npm or not node:
        raise RuntimeError("Node.js and npm are required to compile TableKit tests")
    sources = PROJECT / "Assets" / "Scripts" / "TableKit"
    expected = [
        "TableKit.ts",
        "MirrorProxy.ts",
        "WitnessPlacement.ts",
        "RoleSilhouette.ts",
    ]
    missing = [name for name in expected if not (sources / name).is_file()]
    if missing:
        raise RuntimeError(f"Missing TableKit source files: {missing}")
    run([sys.executable, str(TOOLS / "verify_assets.py")])
    with tempfile.TemporaryDirectory(prefix="countercase-tablekit-") as temp:
        reproduction = Path(temp) / "reproduced-niche"
        run([sys.executable, str(TOOLS / "generate_mirror_niche.py"),
             "--output", str(reproduction), "--asset-only"], cwd=temp)
        shipped = PROJECT / "Assets" / "Art" / "TableKit" / "MuseumMirrorNiche.glb"
        if (reproduction / shipped.name).read_bytes() != shipped.read_bytes():
            raise RuntimeError("Mirror niche reproduction differs from shipped GLB")
        print("PASS niche reproduces byte-for-byte outside project working directory")
        # Exercise the same production geometric gate directly, so the old
        # 672-triangle negative is rejected for its cap conflict, not count/hash.
        validator_tree = ast.parse((TOOLS / "verify_assets.py").read_text(encoding="utf-8"))
        cap_functions = [node for node in validator_tree.body
                         if isinstance(node, ast.FunctionDef)
                         and node.name in ["require", "validate_niche_return_caps"]]
        if len(cap_functions) != 2:
            raise RuntimeError("Missing production niche cap validation functions")
        cap_namespace = {"np": __import__("numpy"), "json": json, "struct": struct}
        exec(compile(ast.Module(body=cap_functions, type_ignores=[]),
                     str(TOOLS / "verify_assets.py"), "exec"), cap_namespace)
        cap_namespace["validate_niche_return_caps"](shipped.read_bytes())
        negative_source = (TOOLS / "generate_mirror_niche.py").read_text(encoding="utf-8")
        trim_call = "\ntrim_exposed_return_caps(m)\n"
        if negative_source.count(trim_call) != 1:
            raise RuntimeError("Niche negative fixture must bypass exactly one cap trim call")
        negative_generator = Path(temp) / "untrimmed-niche-generator.py"
        negative_generator.write_text(negative_source.replace(trim_call, "\n"), encoding="utf-8")
        negative_models = Path(temp) / "untrimmed-niche"
        run([sys.executable, str(negative_generator), "--tools", str(TOOLS),
             "--output", str(negative_models), "--asset-only"], cwd=temp)
        negative_bytes = (negative_models / "MuseumMirrorNiche.glb").read_bytes()
        if hashlib.sha256(negative_bytes).hexdigest() != "9fb3b554e104e8c9cd3368f99faa78cad97a735391aecea40c26511894c6fcd5":
            raise RuntimeError("Niche negative fixture differs from the actual old asset")
        try:
            cap_namespace["validate_niche_return_caps"](negative_bytes)
        except ValueError as error:
            if "coplanar plaster/" not in str(error) or "return X=7.0" not in str(error):
                raise
        else:
            raise RuntimeError("Niche cap gate accepted the old overlapping geometry")
        print("PASS actual X=7 return cap gate accepts repaired asset and rejects untrimmed old geometry")
        # Rebuild the wall-cap repair in an isolated clone, never inside Assets.
        building_project = Path(temp) / "building-reproduction"
        building_tools = building_project / "Tools" / "TableKit"
        building_tools.mkdir(parents=True)
        for filename in ["generate_tablekit.py", "generate_museum.py"]:
            shutil.copyfile(TOOLS / filename, building_tools / filename)
        shutil.copytree(PROJECT / "Assets" / "Art" / "Collection",
                        building_project / "Assets" / "Art" / "Collection")
        building_models = building_project / "Assets" / "Art" / "TableKit"
        building_models.mkdir()
        shutil.copyfile(PROJECT / "Assets" / "Art" / "TableKit" / "manifest.json",
                        building_models / "manifest.json")
        run([sys.executable, str(building_tools / "generate_museum.py")], cwd=temp)
        installed_building = PROJECT / "Assets" / "Art" / "TableKit" / "MuseumBuilding.glb"
        if (building_models / installed_building.name).read_bytes() != installed_building.read_bytes():
            raise RuntimeError("MuseumBuilding reproduction differs from shipped GLB")
        print("PASS repaired building reproduces byte-for-byte in isolated clone")
        empty_tools = Path(temp) / "empty-project" / "Tools" / "TableKit"
        empty_tools.mkdir(parents=True)
        empty_validator = empty_tools / "verify_assets.py"
        shutil.copyfile(TOOLS / "verify_assets.py", empty_validator)
        missing_assets = subprocess.run(
            [sys.executable, str(empty_validator)],
            capture_output=True,
            text=True,
        )
        if (
            missing_assets.returncode == 0
            or "Expected 19 TableKit models" not in missing_assets.stderr
        ):
            raise RuntimeError(
                "Asset validation did not reject an empty project clearly"
            )
        print("PASS empty-project validation rejects missing models")
        output = Path(temp) / "compiled"
        run(
            [
                npm,
                "exec",
                "--yes",
                f"--package={COMPILER}",
                "--",
                "tsc",
                "--target",
                "es2021",
                "--module",
                "commonjs",
                "--strict",
                "--outDir",
                str(output),
                *[str(sources / name) for name in expected],
            ],
            cwd=temp,
        )
        environment = dict(os.environ, TABLEKIT_COMPILED_DIR=str(output))
        run([node, str(TOOLS / "verify_adapter.cjs")], env=environment, cwd=temp)
    print("PASS TableKit assets and adapter checks; temporary compilation removed")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"FAIL TableKit: {error}", file=sys.stderr)
        sys.exit(1)
