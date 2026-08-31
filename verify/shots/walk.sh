#!/bin/bash
set -e
ADB=/c/android-sdk/platform-tools/adb.exe
D="-s 127.0.0.1:16384"
SS="/sdcard/sht.png"

snap(){ $ADB $D shell screencap -p $SS; $ADB $D pull $SS $1 >/dev/null 2>&1; echo "$1"; sleep 0.6; }

tap(){ $ADB $D shell input tap $1 $2; sleep 0.6; }
sw(){ $ADB $D shell input swipe $1 $2 $3 $4 $5 >/dev/null 2>&1; }
text(){ $ADB $D shell input text "$1"; sleep 0.8; }

$ADB $D shell am force-stop com.smartmore.partfinder >/dev/null 2>&1
sleep 1.2
$ADB $D shell am start -n com.smartmore.partfinder/.MainActivity >/dev/null 2>&1
sleep 2.8; snap w02_home_default.png

# 搜索 VS1000P-111-022
tap 700 150
sleep 0.3
text "VS1000P-111-022"
sleep 0.8; snap w03_search_exact.png

# 点击第一张卡片
tap 700 550
sleep 1.0; snap w04_detail_selected.png

# 切选型 tab
tap 1700 2080
sleep 0.8; snap w05_config_tab.png

# 切竞品 tab
tap 2400 2080
sleep 0.8; snap w06_rival_tab.png

# 切收藏 tab
tap 3200 2080
sleep 0.8; snap w07_saved_tab.png

# 返回搜索，清空，输入无效型号
tap 500 2080
sleep 0.8
tap 1450 150
sleep 0.3
text "VS1000P-999-999"
sleep 0.8; snap w08_empty_result.png

# 切回选型，点第一个系列 chip
tap 1700 2080
sleep 0.8
tap 150 220
sleep 0.6; snap w09_config_series.png

# 切到竞品子 tab 品牌（估计位置）
tap 500 2080
sleep 0.4
tap 2400 2080
sleep 0.6
# brand sub-tab x≈1000 y≈220
tap 1000 220
sleep 0.6; snap w10_rival_brand.png

# 竞品 tab 话术
tap 1500 220
sleep 0.6; snap w11_rival_objection.png

# 竞品 tab 行业
tap 2000 220
sleep 0.6; snap w12_rival_industry.png

# 收藏 tab 设置开关
# scroll to bottom to see switches
sw 800 1200 800 500 300
tap 3200 2080
sleep 0.5
sw 800 1200 800 500 300
sleep 0.4; snap w13_saved_settings.png

# 切换竖屏 1080x2400 (phone portrait)
$ADB $D shell wm size 1080x2400 >/dev/null 2>&1
$ADB $D shell wm density 420 >/dev/null 2>&1
sleep 1.2
$ADB $D shell am start -n com.smartmore.partfinder/.MainActivity >/dev/null 2>&1
sleep 1.5; snap w14_portrait.png

# portrait 下点卡片打开 sheet
tap 540 900
sleep 1.0; snap w15_portrait_sheet.png

# 切 fold3 cover 832x2268
$ADB $D shell wm size 832x2268 >/dev/null 2>&1
$ADB $D shell wm density 402 >/dev/null 2>&1
sleep 1.2; snap w16_fold_cover.png

echo "walk done"
