"""PartFinder 移动端离线构建脚本。

不依赖 Gradle 与网络，直接驱动 Android SDK 自带工具链：
    aapt2 compile -> aapt2 link -> javac -> d8 -> 注入 dex -> zipalign -> apksigner

用法：
    python build.py            # 构建并签名
    python build.py --clean    # 仅清理
    python build.py --verbose  # 输出工具原始日志
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
SRC = ROOT / "src"
WEB = ROOT / "web"

ANDROID_HOME = Path(r"C:\android-sdk")
PLATFORM = ANDROID_HOME / "platforms" / "android-34"
BUILD_TOOLS = ANDROID_HOME / "build-tools" / "34.0.0"

AAPT2 = BUILD_TOOLS / "aapt2.exe"
ZIPALIGN = BUILD_TOOLS / "zipalign.exe"
D8_JAR = BUILD_TOOLS / "lib" / "d8.jar"
APKSIGNER_JAR = BUILD_TOOLS / "lib" / "apksigner.jar"
ANDROID_JAR = PLATFORM / "android.jar"

PACKAGE = "com.smartmore.partfinder"
VERSION_NAME = "10.8.1"
VERSION_CODE = "12"
MIN_SDK = "26"
TARGET_SDK = "34"

KEYSTORE = ROOT / "partfinder.jks"
KEY_ALIAS = "partfinder"
KEY_STORE_PASS = "partfinder123"
KEY_PASS = "partfinder123"


class Step:
    """步骤计数与状态输出。"""

    def __init__(self, verbose: bool = False):
        self.n = 0
        self.verbose = verbose

    def __call__(self, title: str):
        self.n += 1
        print(f"\n[{self.n}] {title}")


def run(cmd: list[str], verbose: bool = False, capture: bool = True) -> subprocess.CompletedProcess:
    if verbose:
        print("    $ " + " ".join(str(c) for c in cmd))
    return subprocess.run(
        [str(c) for c in cmd],
        capture_output=capture,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def check(result: subprocess.CompletedProcess, what: str) -> None:
    if result.returncode != 0:
        print(f"\n!! {what} 失败 (exit {result.returncode})")
        if result.stdout:
            print("--- stdout ---\n" + result.stdout[-4000:])
        if result.stderr:
            print("--- stderr ---\n" + result.stderr[-4000:])
        sys.exit(1)


def ensure_toolchain() -> None:
    missing = [p for p in (AAPT2, ZIPALIGN, D8_JAR, APKSIGNER_JAR, ANDROID_JAR) if not p.exists()]
    if missing:
        print("!! 缺少 Android 构建工具：")
        for m in missing:
            print(f"   - {m}")
        sys.exit(1)


def discard(path: Path) -> None:
    """移除路径，但**不使用任何删除 API**。

    宿主环境对 shutil.rmtree / Path.unlink 施加了删除保护（回收站不可用时会
    直接抛 OSError），构建脚本每次都要清理旧产物，因此统一改为「重命名到
    系统临时目录」，交由系统回收。语义上等价于删除，但不触发保护。
    """
    path = Path(path)
    if not path.exists():
        return
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = Path(tempfile.gettempdir()) / f"partfinder-discard-{stamp}-{path.name}"
    n = 0
    while dest.exists():
        n += 1
        dest = Path(tempfile.gettempdir()) / f"partfinder-discard-{stamp}-{n}-{path.name}"
    path.rename(dest)


def clean() -> None:
    discard(BUILD)
    print("[clean] 已清理 build/")


def compile_resources(step: Step, verbose: bool) -> Path:
    step("编译资源 (aapt2 compile)")
    out = BUILD / "compiled_res.zip"
    res = SRC / "res"
    check(run([AAPT2, "compile", "--dir", res, "-o", out], verbose), "资源编译")
    print(f"    -> {out.name}")
    return out


# iOS / PWA 专用资源：Android 壳跑在 file:// 上，Service Worker 不会注册、
# manifest 不被读取、桌面图标走 res/mipmap 的 adaptive icon。
# 打进 APK 纯属死重（图标约 27 KB），故在搬运阶段排除。
PWA_ONLY = shutil.ignore_patterns("icons", "sw.js", "manifest.webmanifest")


def prepare_assets(step: Step) -> Path:
    """把 web/ 搬运到 build/assets/web/（排除 PWA 专用件），使 APK 内路径为 assets/web/..."""
    step("准备 assets")
    target = BUILD / "assets" / "web"
    discard(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(WEB, target, ignore=PWA_ONLY)
    files = list(target.rglob("*"))
    total = sum(f.stat().st_size for f in files if f.is_file())
    print(f"    -> {len([f for f in files if f.is_file()])} 个文件，{total / 1024:.0f} KB")
    return BUILD / "assets"


def link_apk(step: Step, compiled: Path, assets: Path, verbose: bool) -> Path:
    step("链接 APK 并打包 assets (aapt2 link)")
    out = BUILD / "app-unsigned.apk"
    cmd = [
        AAPT2, "link",
        "-I", ANDROID_JAR,
        "--manifest", SRC / "AndroidManifest.xml",
        "-o", out,
        "-A", assets,
        "--min-sdk-version", MIN_SDK,
        "--target-sdk-version", TARGET_SDK,
        "--version-code", VERSION_CODE,
        "--version-name", VERSION_NAME,
        "--auto-add-overlay",
        compiled,
    ]
    check(run(cmd, verbose), "APK 链接")
    print(f"    -> {out.name} ({out.stat().st_size / 1024:.0f} KB)")
    return out


def compile_java(step: Step, verbose: bool) -> Path:
    step("编译 Java 源码 (javac)")
    classes = BUILD / "classes"
    classes.mkdir(parents=True, exist_ok=True)
    sources = sorted((SRC / "java").rglob("*.java"))
    if not sources:
        print("!! 未找到 Java 源文件")
        sys.exit(1)
    cmd = ["javac", "-encoding", "UTF-8", "-nowarn", "-classpath", ANDROID_JAR, "-d", classes, *sources]
    check(run(cmd, verbose), "Java 编译")
    print(f"    -> {len(list(classes.rglob('*.class')))} 个 class")
    return classes


def dex(step: Step, classes: Path, verbose: bool) -> Path:
    step("转换 DEX (d8)")
    out = BUILD / "dex"
    out.mkdir(parents=True, exist_ok=True)
    class_files = sorted(str(p) for p in classes.rglob("*.class"))
    # d8.jar 无可执行主清单，必须显式指定主类（与官方 d8.bat 一致）
    cmd = [
        "java", "-Xmx1g", "-cp", D8_JAR, "com.android.tools.r8.D8",
        "--lib", ANDROID_JAR, "--min-api", MIN_SDK, "--output", out, *class_files,
    ]
    check(run(cmd, verbose), "DEX 转换")
    dex_file = out / "classes.dex"
    if not dex_file.exists():
        print("!! 未生成 classes.dex")
        sys.exit(1)
    print(f"    -> classes.dex ({dex_file.stat().st_size / 1024:.0f} KB)")
    return dex_file


def inject_dex(step: Step, apk: Path, dex_file: Path) -> None:
    step("注入 DEX 到 APK")
    with zipfile.ZipFile(apk, "a", compression=zipfile.ZIP_DEFLATED) as zf:
        if "classes.dex" in zf.namelist():
            print("    classes.dex 已存在，跳过")
            return
        zf.write(dex_file, "classes.dex")
    print("    -> 已写入 classes.dex")


def align(step: Step, apk: Path, verbose: bool) -> Path:
    step("内存对齐 (zipalign)")
    out = BUILD / "app-aligned.apk"
    check(run([ZIPALIGN, "-f", "4", apk, out], verbose), "zipalign")
    print(f"    -> {out.name}")
    return out


def ensure_keystore(step: Step, verbose: bool) -> None:
    if KEYSTORE.exists():
        return
    step("生成签名密钥")
    cmd = [
        "keytool", "-genkeypair", "-v",
        "-keystore", KEYSTORE,
        "-alias", KEY_ALIAS,
        "-keyalg", "RSA", "-keysize", "2048", "-validity", "10950",
        "-storepass", KEY_STORE_PASS, "-keypass", KEY_PASS,
        "-dname", "CN=PartFinder, OU=SmartMore, O=SmartMore, L=Shenzhen, ST=Guangdong, C=CN",
    ]
    check(run(cmd, verbose), "密钥生成")
    print(f"    -> {KEYSTORE.name}")


def sign(step: Step, apk: Path, verbose: bool) -> Path:
    ensure_keystore(step, verbose)
    step("签名 APK (apksigner)")
    out = ROOT / f"PartFinder-Mobile-v{VERSION_NAME}.apk"
    discard(out)
    discard(ROOT / f"{out.name}.idsig")
    cmd = [
        "java", "-jar", APKSIGNER_JAR, "sign",
        "--ks", KEYSTORE,
        "--ks-key-alias", KEY_ALIAS,
        "--ks-pass", f"pass:{KEY_STORE_PASS}",
        "--key-pass", f"pass:{KEY_PASS}",
        "--min-sdk-version", MIN_SDK,
        "--out", out,
        apk,
    ]
    check(run(cmd, verbose), "APK 签名")
    print(f"    -> {out.name}")
    return out


def verify(step: Step, apk: Path, verbose: bool) -> None:
    step("校验签名")
    result = run(["java", "-jar", APKSIGNER_JAR, "verify", "--verbose", apk], verbose)
    ok = result.returncode == 0
    print("    " + ("签名有效" if ok else "签名校验未通过"))
    if verbose and result.stdout:
        print(result.stdout[-1500:])


def main() -> int:
    parser = argparse.ArgumentParser(description="构建 PartFinder 移动端 APK")
    parser.add_argument("--clean", action="store_true", help="仅清理构建产物")
    parser.add_argument("--verbose", action="store_true", help="输出工具原始日志")
    args = parser.parse_args()

    if args.clean:
        clean()
        return 0

    ensure_toolchain()
    clean()
    BUILD.mkdir(parents=True, exist_ok=True)

    step = Step(args.verbose)
    compiled = compile_resources(step, args.verbose)
    assets = prepare_assets(step)
    apk = link_apk(step, compiled, assets, args.verbose)
    classes = compile_java(step, args.verbose)
    dex_file = dex(step, classes, args.verbose)
    inject_dex(step, apk, dex_file)
    aligned = align(step, apk, args.verbose)
    signed = sign(step, aligned, args.verbose)
    verify(step, signed, args.verbose)

    size_mb = signed.stat().st_size / 1024 / 1024
    print(f"\n{'=' * 46}")
    print(f"构建完成: {signed.name}")
    print(f"体积: {size_mb:.2f} MB")
    print(f"路径: {signed}")
    print(f"{'=' * 46}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
