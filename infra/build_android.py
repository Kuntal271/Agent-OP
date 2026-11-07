"""Build the Hermes Android APK in a throwaway Modal sandbox (no local Android toolchain needed).

    cd ~/Agent-OP/infra
    uv run --python 3.12 --with modal==1.6.3 python build_android.py [--abi arm64-v8a] [--out ~/Downloads]

Requires `cd ../mobile && npx expo prebuild --platform android` first (generates mobile/android, gitignored).
Produces a release APK signed with the Expo template's debug key: fine for sideloading, not for Play Store.
"""

import argparse
import io
import pathlib
import subprocess
import sys
import tarfile
import time

import modal

APP_NAME = "kuntal-hermes-remote"
ENVIRONMENT = "main"
MOBILE = pathlib.Path(__file__).resolve().parent.parent / "mobile"
SDK = "/opt/android"
JAVA_HOME = "/usr/lib/jvm/java-17-openjdk-amd64"
# Pinned by the generated project (react-native/gradle/libs.versions.toml, SDK 58 / RN 0.88).
SDK_PACKAGES = ["platform-tools", "platforms;android-37", "build-tools;37.0.0", "ndk;27.1.12297006", "cmake;3.22.1"]
SDKM = f"{SDK}/cmdline-tools/latest/bin/sdkmanager"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("openjdk-17-jdk-headless", "curl", "unzip", "git", "xz-utils", "ca-certificates", "file")
    .run_commands(
        f"mkdir -p {SDK}/cmdline-tools && cd /tmp && curl -fsSLo clt.zip "
        "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip && "
        f"unzip -q clt.zip -d {SDK}/cmdline-tools && mv {SDK}/cmdline-tools/cmdline-tools {SDK}/cmdline-tools/bootstrap",
        f"yes | {SDK}/cmdline-tools/bootstrap/bin/sdkmanager --sdk_root={SDK} --licenses > /dev/null",
        f"{SDK}/cmdline-tools/bootstrap/bin/sdkmanager --sdk_root={SDK} 'cmdline-tools;latest' > /dev/null",
        f"yes | {SDKM} --sdk_root={SDK} --licenses > /dev/null",
        f"{SDKM} --sdk_root={SDK} " + " ".join(f"'{p}'" for p in SDK_PACKAGES) + " > /dev/null",
        "cd /opt && f=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk '/linux-x64.tar.xz/{print $2}') && "
        "curl -fsSL https://nodejs.org/dist/latest-v24.x/$f | tar -xJ && ln -sf /opt/${f%.tar.xz}/bin/* /usr/local/bin/",
        "node --version && java -version 2>&1 | head -1",
    )
    .env({"ANDROID_HOME": SDK, "ANDROID_SDK_ROOT": SDK, "JAVA_HOME": JAVA_HOME, "CI": "1",
          "GRADLE_OPTS": "-Dorg.gradle.jvmargs=-Xmx10g -Dorg.gradle.workers.max=8"})
)

EXCLUDE_DIRS = {"node_modules", ".expo", "dist", "build", ".gradle", ".cxx", ".kotlin", "scripts"}


def _source_tarball() -> bytes:
    if not (MOBILE / "android").is_dir():
        sys.exit("mobile/android missing: run `npx expo prebuild --platform android` in mobile/ first")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        def keep(ti: tarfile.TarInfo):
            parts = set(pathlib.PurePosixPath(ti.name).parts)
            return None if parts & EXCLUDE_DIRS else ti
        tar.add(MOBILE, arcname="mobile", filter=keep)
    return buf.getvalue()


def _run(sb: modal.Sandbox, cmd: str, stream_filter: str | None = None) -> tuple[int, str]:
    proc = sb.exec("bash", "-lc", cmd)
    if stream_filter is None:
        out = proc.stdout.read() + proc.stderr.read()
        return proc.wait(), out
    for line in proc.stdout:  # show progress lines as they happen
        print(line, end="", flush=True)
    err = proc.stderr.read()
    return proc.wait(), err


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--abi", default="arm64-v8a", help="comma list; arm64-v8a covers modern phones")
    ap.add_argument("--out", default=str(pathlib.Path.home() / "Downloads"))
    args = ap.parse_args()

    version = __import__("json").loads((MOBILE / "app.json").read_text())["expo"]["version"]
    src = _source_tarball()
    print(f"source tarball: {len(src)/1e6:.1f} MB")
    app = modal.App.lookup(APP_NAME, create_if_missing=True, environment_name=ENVIRONMENT)
    t0 = time.time()
    with modal.enable_output():
        sb = modal.Sandbox.create("sleep", "infinity", app=app, image=image, cpu=8, memory=16384, timeout=3600)
    print(f"build sandbox: {sb.object_id} (image ready in {time.time()-t0:.0f}s)")
    try:
        sb.filesystem.write_bytes(src, "/tmp/src.tgz")
        rc, out = _run(sb, "mkdir -p /work && cd /work && tar xzf /tmp/src.tgz && cd mobile && "
                           "npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -5")
        print(f"[npm ci] rc={rc}\n{out[-1500:]}")
        if rc:
            return 1
        t1 = time.time()
        rc, err = _run(
            sb,
            "cd /work/mobile/android && chmod +x gradlew && ./gradlew :app:assembleRelease --no-daemon --console=plain "
            f"-PreactNativeArchitectures={args.abi} > /tmp/gradle.log 2>&1; rc=$?; "
            "grep -E '^(BUILD|FAILURE)|What went wrong|^e: |error:' /tmp/gradle.log | head -40; exit $rc",
            stream_filter="summary",
        )
        print(f"[gradle] rc={rc} in {(time.time()-t1)/60:.1f} min")
        if rc:
            _, tail = _run(sb, "tail -60 /tmp/gradle.log")
            print(tail)
            return 1
        apk = "/work/mobile/android/app/build/outputs/apk/release/app-release.apk"
        bt = f"{SDK}/build-tools/37.0.0"
        rc, info = _run(sb, f"ls -la {apk} && sha256sum {apk} && {bt}/apksigner verify --print-certs {apk} | head -4 && "
                            f"{bt}/aapt2 dump badging {apk} | grep -E \"^(package|sdkVersion|targetSdkVersion|application-label|native-code)\" && "
                            f"echo '--- merged permissions' && {bt}/aapt2 dump permissions {apk} | sort")
        print(f"[verify] rc={rc}\n{info}")
        if rc:
            return 1
        data = sb.filesystem.read_bytes(apk)
        out_dir = pathlib.Path(args.out).expanduser()
        out_dir.mkdir(parents=True, exist_ok=True)
        dest = out_dir / f"Hermes-{version}-{args.abi.replace(',', '+')}.apk"
        dest.write_bytes(data)
        print(f"APK: {dest} ({len(data)/1e6:.1f} MB)")
        print(subprocess.run(["shasum", "-a", "256", str(dest)], capture_output=True, text=True).stdout.strip())
        return 0
    finally:
        sb.terminate()
        print(f"build sandbox terminated after {(time.time()-t0)/60:.1f} min")


if __name__ == "__main__":
    sys.exit(main())
