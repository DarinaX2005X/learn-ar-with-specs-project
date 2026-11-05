"""Run from a fresh clone: python Tools/TableKit/test_tablekit.py

Requires Python 3.10+, numpy, Node.js and npm. The first run downloads the pinned
TypeScript 5.9.3 compiler into npm's cache. Compilation goes into os.tmpdir and is
removed on exit. Tests never regenerate models or write inside Assets.
"""

from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile

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
            or "Expected 15 TableKit models" not in missing_assets.stderr
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
