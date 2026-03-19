#!/usr/bin/env python3

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import zipfile


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PACKAGE_FILES = [
    "function_app.py",
    "pdf_generator.py",
    "host.json",
    "requirements.txt",
]


def run(command: list[str], cwd: pathlib.Path | None = None) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def build_package(output_path: pathlib.Path, python_bin: str) -> None:
    with tempfile.TemporaryDirectory(prefix="function-package-") as temp_dir:
        temp_root = pathlib.Path(temp_dir)
        stage_dir = temp_root / "stage"
        metadata_dir = temp_root / "generated"
        site_packages = stage_dir / ".python_packages" / "lib" / "site-packages"
        stage_dir.mkdir(parents=True, exist_ok=True)
        metadata_dir.mkdir(parents=True, exist_ok=True)
        site_packages.mkdir(parents=True, exist_ok=True)

        for file_name in PACKAGE_FILES:
            shutil.copy2(REPO_ROOT / file_name, stage_dir / file_name)

        run(
            [
                python_bin,
                "-m",
                "pip",
                "install",
                "--upgrade",
                "pip",
            ],
            cwd=REPO_ROOT,
        )
        run(
            [
                python_bin,
                "-m",
                "pip",
                "install",
                "--only-binary=:all:",
                "--platform",
                "manylinux2014_x86_64",
                "--python-version",
                "311",
                "--implementation",
                "cp",
                "--target",
                str(site_packages),
                "-r",
                str(REPO_ROOT / "requirements.txt"),
            ],
            cwd=REPO_ROOT,
        )

        sys.path.insert(0, str(REPO_ROOT))
        sys.path.insert(0, str(site_packages))
        import function_app  # pylint: disable=import-outside-toplevel

        for fn in function_app.app.get_functions():
            fn_dir = metadata_dir / fn.get_function_name()
            fn_dir.mkdir(parents=True, exist_ok=True)
            metadata = json.loads(fn.get_function_json())
            if metadata.get("scriptFile") == "function_app.py":
                metadata["scriptFile"] = "../function_app.py"
            (fn_dir / "function.json").write_text(json.dumps(metadata), encoding="utf-8")

        for child in metadata_dir.iterdir():
            destination = stage_dir / child.name
            if destination.exists():
                shutil.rmtree(destination)
            shutil.copytree(child, destination)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in stage_dir.rglob("*"):
                if path.is_dir() or path.name.endswith(".pyc") or "__pycache__" in path.parts:
                    continue
                archive.write(path, path.relative_to(stage_dir))


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a deterministic Azure Functions deployment package.")
    parser.add_argument("--output", default="deploy.zip", help="Output zip path")
    parser.add_argument("--python", dest="python_bin", default=sys.executable, help="Python executable to use")
    args = parser.parse_args()

    output_path = pathlib.Path(args.output)
    if not output_path.is_absolute():
        output_path = REPO_ROOT / output_path

    build_package(output_path=output_path, python_bin=args.python_bin)
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())