#!/system/bin/sh
# 端到端回归：安装 -> 启动 -> 用 input text（非坐标点击）驱动核心链路 -> 多分辨率验证
#
# 两个环境坑（已规避）：
#  1. $ADB 是 Windows 程序，路径必须是 C:/... 形式，git-bash 的 /c/... 它识别不了。
#  2. `am start -W` 在 MuMu 上会永久挂起；改用非阻塞 `am start` + logcat
#     的 "Displayed ... +Xms" 取冷启动耗时，数据更准且不阻塞。
#
# 为什么不用 input tap 点击：MuMu 的 $ADB input 坐标系与 screencap 输出非线性对应。
# 搜索页启动即自动聚焦 #q，可直接 input text，完全绕开坐标问题。

set -u
APK="C:/Users/znsn2/Desktop/PartFinder_V9.0/PartFinderMobileV2/PartFinder-Mobile-v10.0.0.apk"
PKG="com.smartmore.partfinder"
SHOTS="C:/Users/znsn2/Desktop/PartFinder_V9.0/PartFinderMobileV2/verify/shots"
LOG="C:/Users/znsn2/Desktop/PartFinder_V9.0/PartFinderMobileV2/verify/logs"

ADB="adb -s 127.0.0.1:16384"

mkdir -p "$SHOTS" "$LOG"
say() { echo "== $* =="; }
shot() { # shot <设备端文件名> <本地文件名>
  $ADB shell screencap -p "/sdcard/$1" >/dev/null 2>&1
  $ADB pull "/sdcard/$1" "$SHOTS/$2" >/dev/null 2>&1
  $ADB shell rm "/sdcard/$1" >/dev/null 2>&1
  echo "  -> $2"
}

say "安装 APK"
$ADB install -r "$APK" 2>&1 | tail -2

say "冷启动计时（logcat Displayed，非阻塞）"
$ADB logcat -c
for i in 1 2 3; do
  $ADB shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 1
  $ADB logcat -c >/dev/null 2>&1
  $ADB shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
  sleep 5
  T=$($ADB logcat -d -v brief 2>/dev/null | grep -o "Displayed $PKG/.MainActivity: +[0-9]*m*s*[0-9]*ms" | head -1 | sed 's/.*+//')
  echo "  第 $i 次: ${T:-未捕获}"
done

say "开始采集 logcat"
$ADB logcat -c
sleep 1

say "[1] 展开态 2160x3840 @540dpi (640dp)"
$ADB shell wm size 2160x3840 >/dev/null 2>&1
$ADB shell wm density 540 >/dev/null 2>&1
sleep 2
$ADB shell am force-stop "$PKG" >/dev/null 2>&1
$ADB shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 4
shot pf_r01.png r01_home.png

say "[2] 输入完整型号（自动聚焦，无需点击）"
$ADB shell input text "VS1000P-111-022"
sleep 2
shot pf_r02.png r02_search.png

say "[3] 清空后输入不存在的型号（空状态分因文案）"
$ADB shell input keyevent KEYCODE_MOVE_END
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do $ADB shell input keyevent KEYCODE_DEL; done
sleep 1
$ADB shell input text "ZZQQXX99"
sleep 2
shot pf_r03.png r03_empty.png

say "[4] 输入无套包规则的 VN4000（套包告警）"
for i in 1 2 3 4 5 6 7 8 9 10; do $ADB shell input keyevent KEYCODE_DEL; done
sleep 1
$ADB shell input text "VN4000"
sleep 2
shot pf_r04.png r04_vn4000.png

say "[5] FOLD3 外屏 832x2268 @402dpi（原列表区黑屏缺陷场景）"
$ADB shell wm size 832x2268 >/dev/null 2>&1
$ADB shell wm density 402 >/dev/null 2>&1
sleep 3
$ADB shell am force-stop "$PKG" >/dev/null 2>&1
$ADB shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 5
shot pf_r05.png r05_cover.png

say "[6] 外屏下搜索（窄屏列表渲染）"
$ADB shell input text "VS2000"
sleep 3
shot pf_r06.png r06_cover_search.png

say "[7] FOLD3 内屏 1768x2208 @420dpi"
$ADB shell wm size 1768x2208 >/dev/null 2>&1
$ADB shell wm density 420 >/dev/null 2>&1
sleep 3
$ADB shell am force-stop "$PKG" >/dev/null 2>&1
$ADB shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 5
shot pf_r07.png r07_inner.png

$ADB shell wm size reset >/dev/null 2>&1
$ADB shell wm density reset >/dev/null 2>&1

say "导出 logcat"
$ADB logcat -d -v threadtime > "$LOG/regress_logcat.txt" 2>&1
echo "  -> $(wc -l < "$LOG/regress_logcat.txt") 行"

echo ""
say "稳定性统计"
echo "  FATAL EXCEPTION : $(grep -c 'FATAL EXCEPTION' "$LOG/regress_logcat.txt")"
echo "  ANR in          : $(grep -c 'ANR in ' "$LOG/regress_logcat.txt")"
echo "  am_crash        : $(grep -c 'am_crash' "$LOG/regress_logcat.txt")"
echo "  am_anr          : $(grep -c 'am_anr' "$LOG/regress_logcat.txt")"
echo "  控制台 JS 错误  : $(grep -ci 'Uncaught\|CONSOLE(' "$LOG/regress_logcat.txt")"

echo ""
say "完成"
