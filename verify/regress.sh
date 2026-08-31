#!/system/bin/sh
# =============================================================
# PartFinder Mobile 真机回归（v10.1.0+）
#
# 用法：bash verify/regress.sh [APK路径]
#   默认 APK = 仓库根目录 PartFinder-Mobile-v10.1.0.apk
#
# 三个环境坑（已规避，勿改回）：
#  1. $ADB 是 Windows 程序，参数路径必须 C:/... 形式；/sdcard/... 会被
#     git-bash 转译成本地路径，screencap/pull 一律用 //sdcard/... 双斜杠。
#  2. `am start -W` 在 MuMu 上永久挂起；用非阻塞 am start + logcat
#     的 "Displayed ... +Xms" 取冷启动耗时。
#  3. adb input text / keyevent 无法写入 MuMu 的 WebView 输入框
#     （v10.0.0 起既有 harness 限制，不代表真机）；输入类链路由
#     tools/test_ui.js 的 DOM 断言覆盖，本脚本只做渲染与稳定性。
#
# MuMu 特性：窗口为横向，wm size 竖屏分辨率会被横排渲染；
# 竖屏窄栏(sheet)形态无法在本模拟器真实重现，留待真机抽检。
# =============================================================
set -u
APK="${1:-C:/Users/znsn2/Desktop/PartFinder_V9.0/PartFinderMobileV2/PartFinder-Mobile-v10.1.0.apk}"
PKG="com.smartmore.partfinder"
SHOTS="C:/Users/znsn2/Desktop/PartFinder_V9.0/PartFinderMobileV2/verify/shots"
LOG="C:/Users/znsn2/Desktop/PartFinder_V9.0/PartFinderMobileV2/verify/logs"
ADB="adb -s 127.0.0.1:16384"

mkdir -p "$SHOTS" "$LOG"
say() { echo "== $* =="; }
shot() {
  $ADB shell "screencap -p /sdcard/pf_shot.png" >/dev/null 2>&1
  $ADB pull //sdcard/pf_shot.png "$SHOTS/$2" >/dev/null 2>&1
  $ADB shell "rm /sdcard/pf_shot.png" >/dev/null 2>&1
  echo "  -> $2"
}

say "安装 APK"
$ADB install -r "$APK" 2>&1 | tail -1

say "确认设备端版本"
$ADB shell dumpsys package $PKG | grep versionName | head -1

say "冷启动计时 x3（logcat Displayed，非阻塞）"
for i in 1 2 3; do
  $ADB shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 1
  $ADB logcat -c >/dev/null 2>&1
  $ADB shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
  sleep 5
  T=$($ADB logcat -d 2>/dev/null | grep -o "Displayed $PKG/.* +[0-9]*ms" | tail -1 | sed 's/.*+//')
  echo "  第 $i 次: ${T:-未捕获}"
done

say "[1] 默认分辨率：首页（深色）"
$ADB shell wm size reset >/dev/null 2>&1
$ADB shell wm density reset >/dev/null 2>&1
$ADB shell am force-stop "$PKG" >/dev/null 2>&1
$ADB shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 5
shot v_home.png v101_home.png

say "[2] 点击客户页签（5 均分导航的第 4 个，x=屏宽*59%）"
SIZE=$($ADB shell wm size | grep Physical | grep -o '[0-9]*x[0-9]*' | tr 'x' ' ')
W=$(echo $SIZE | awk '{print $1}'); H=$(echo $SIZE | awk '{print $2}')
$ADB shell input tap $(( W * 59 / 100 )) $(( H * 95 / 100 ))
sleep 2
shot v_customers.png v101_customers.png

say "[3] 点击左栏第一张卡片开详情（x=18%, y=33%）"
$ADB shell input tap $(( W * 18 / 100 )) $(( H * 33 / 100 ))
sleep 2
shot v_detail.png v101_detail.png

say "[4] 返回键（宽屏双栏无层叠 → 应用退到后台属预期）"
$ADB shell input keyevent 4
sleep 2
$ADB shell "pidof $PKG" >/dev/null 2>&1 && echo "  进程存活（宽屏返回=退出应用，预期行为；窄屏 sheet 场景见 ROUND-2.md）"

say "[5] logcat 稳定性统计"
$ADB logcat -d -v threadtime > "$LOG/regress_logcat_latest.txt" 2>&1
echo "  行数             : $(wc -l < "$LOG/regress_logcat_latest.txt")"
echo "  FATAL EXCEPTION : $(grep -c 'FATAL EXCEPTION' "$LOG/regress_logcat_latest.txt")"
echo "  ANR in          : $(grep -c 'ANR in ' "$LOG/regress_logcat_latest.txt")"
echo "  am_crash        : $(grep -c 'am_crash' "$LOG/regress_logcat_latest.txt")"
echo "  am_anr          : $(grep -c 'am_anr' "$LOG/regress_logcat_latest.txt")"
echo "  JS console 错误 : $(grep -ci 'Uncaught\|CONSOLE(' "$LOG/regress_logcat_latest.txt")"

echo ""
say "完成（浅色模式与竖屏 sheet 形态在本模拟器不可复现，见脚本头注释）"
