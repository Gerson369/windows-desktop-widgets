# 桌面搭子

**把常用文件、待办和喝水活动提醒放在 Windows 桌面上。**

桌面搭子提供文件收纳框、日常工具面板和健康提醒面板。常用软件可以置顶后双击打开；待办、便签、饮水记录和布局保存在本机，日常使用无需反复打开完整窗口。

适用于 **Windows 10 / 11 x64** · 当前版本 **v2.6.17**

[下载最新版](https://github.com/Gerson369/windows-desktop-widgets/releases/latest) · [三步开始用](#三步开始用) · [功能截图](#功能截图) · [反馈问题](https://github.com/Gerson369/windows-desktop-widgets/issues)

## 下载与安装

打开 [Releases 下载页](https://github.com/Gerson369/windows-desktop-widgets/releases/latest)，在附件中选择：

| 版本 | 下载文件 | 怎么使用 |
| --- | --- | --- |
| 安装版 | [windows-desktop-widgets-2.6.17-x64-setup.exe](https://github.com/Gerson369/windows-desktop-widgets/releases/download/v2.6.17/windows-desktop-widgets-2.6.17-x64-setup.exe) | 运行安装向导，适合长期放在这台电脑使用。 |
| 免安装版 | [windows-desktop-widgets-2.6.17-x64-portable.exe](https://github.com/Gerson369/windows-desktop-widgets/releases/download/v2.6.17/windows-desktop-widgets-2.6.17-x64-portable.exe) | 下载后直接运行，无需安装向导。 |

两种版本功能相同，沿用已有数据目录与配置格式。免安装版的数据也按应用设置保存在本机，不代表配置会跟随 exe 文件移动。软件未配置代码签名，Windows 可能显示发布者提示。

已有旧版时，请先按下方的[升级步骤](#升级与数据保留)退出旧程序，再打开新版。

## 三步开始用

1. **打开软件，展开“桌面收纳”。** 默认进入“全部”，也可以切到应用、文件、图片或影音。搜索框查找当前分类，双击项目打开；拖入其他文件或文件夹可添加引用，原文件位置不变。
2. **把每天要用的项目置顶。** 右键应用、图片或文件，选择“置顶”。它会排到“全部”和所属分类的前面，重启后仍保留；需要恢复普通排序时，右键选择“取消置顶”。
3. **记待办，设提醒。** 在“桌面搭子”添加待办，点击事项的铃铛设置时间与提醒。点击面板右上角的设置按钮进入“健康”，设置饮水目标、时段和提醒间隔；喝水后点水杯，活动后点脊柱图标。

希望开机就能用，可以在 **设置 → 桌面 → 组件** 开启“开机启动”。面板被隐藏时，点击系统托盘中的“桌面搭子”图标可重新显示。

## 功能一览

| 功能 | 可以做什么 |
| --- | --- |
| 桌面收纳 | 默认查看全部项目，按应用、文件、图片、影音切换；搜索、筛选、排序、多选分类、置顶、重命名和移到回收站。分类名称在上、数量小字在下，窄窗口也保留五栏。 |
| 待办 | 按“待办 / 今天 / 计划 / 已完成”查看；设置安排日期、具体时间和提醒，逾期事项有标识。 |
| 喝水与活动 | 显示每日目标、已喝与剩余水量；按当前杯量记录，支持固定间隔和每日计划，喝水与活动分别撤销。 |
| 日常工具 | 日历、便签、倒数日、专注计时、时钟、多城市天气，以及 CPU、内存、GPU、网络等设备读数。 |
| 布局与外观 | 拖动吸附、面板显隐、透明度、配色、字号与布局备份；健康面板可单独摆放，也可贴靠收纳框或桌面搭子。 |
| 数据备份 | 在 **设置 → 桌面 → 数据** 导出全部数据或从备份导入。导入会替换当前配置，请先备份。 |

## 喝水量怎么算

选择 **固定间隔** 后，软件按“剩余目标水量 ÷ 从本轮实际开始计时到结束时间的提醒次数”计算满杯量。实际开始时间早于设置的开始时间时，按设置的开始时间分配；晚开电脑时就按实际开始时间分配。

例如当天目标 2L、还没记录喝水、结束时间 20:00、每 15 分钟提醒一次：

| 实际开始时间 | 用于分配的时长 | 提醒次数 | 本轮满杯约多少 |
| --- | --- | --- | --- |
| 10:00 | 10 小时 | 40 次 | 50ml |
| 11:00 | 9 小时 | 36 次 | 56ml |

水杯随计时逐渐蓄水，显示的毫升数是**当前杯量**。11:00 开始的例子中，半个间隔时约为 28ml；此时点击水杯只累计 28ml，然后按剩余水量和剩余时段重新分配下一轮，不会把半杯算成一整杯。显示量取整，最后一杯不超过剩余目标；单次记录上限为 2000ml，临近结束不强制补足。

选择 **每日计划** 时，则由你设置水杯容量，软件按剩余水量和剩余时段自动安排下一次提醒。两种方式共用当天饮水记录；重新打开软件会重新计时，保留当天已记录的水量。

喝水后点水杯、活动后点脊柱图标，对应位置会提供 **15 秒撤销**。两边各自保留最近一次操作，交替点击不会互相覆盖；撤销会恢复该项原来的记录和计时。同一项的新操作会替换旧撤销，过期、日期或相关设置改变后，旧操作不能覆盖当前数据。

水杯溢水、面板积水和脊柱弯曲等效果只是计时提醒。软件不检测真实饮水量或坐姿；饮水目标由你设置，分配结果不属于个体饮水建议。

## v2.6.17 本次更新

本次发布包含 v2.6.16 的新增功能和修复，并进一步压缩分类栏。查看[完整更新说明](https://github.com/Gerson369/windows-desktop-widgets/releases/tag/v2.6.17)。

- **分类更好找**：默认打开“全部”，也可分类型查看；分类名称缩短为“全部 / 应用 / 文件 / 图片 / 影音”，五栏等宽，数量放在名称下方，保持原有高度。
- **常用项目置顶**：右键置顶或取消置顶；在全部及单个分类中优先显示，重启后保留，双击打开方式照旧。应用内重命名和运行期间检测到的外部改名会同步更新置顶路径。
- **晚开电脑也能分配水量**：固定间隔根据实际开始时间、设定结束时间和剩余目标计算每次毫升数，提前喝半杯只记录半杯。
- **喝水与活动各自撤销**：两项操作分别保留 15 秒撤销，解决交替点击后无法撤销另一项的问题。
- **启动后直接跟随吸附**：健康面板贴着收起的收纳框时，首次展开即可跟随，无需重新拖动吸附。

## 升级与数据保留

1. 右键系统托盘中的“桌面搭子”图标，选择 **退出**，等待原桌面图标恢复。收起或隐藏面板不等于退出程序。
2. 安装新版，或运行新版免安装文件。两种版本继续读取原有本地配置，无需为了升级删除数据。
3. 检查待办、便签、置顶项目和布局是否保留。需要额外备份时，可事先在 **设置 → 桌面 → 数据** 选择“导出全部数据”。

收纳框分类和拖入引用保留原文件位置；在整理预览中明确选择移动文件、重命名或移到回收站时，才执行相应文件操作。通过托盘退出会恢复原桌面图标。

## 功能截图

下方保留 26 张演示截图，按功能分组，每排两张，点击可查看原图。图库主要来自 v2.6.12–v2.6.15，展示对应功能；v2.6.17 的“全部”分类、置顶和紧凑分类栏请以当前软件为准，旧图并未逐张更新为新布局。

截图使用隔离演示数据，天气与设备读数为固定样本，并非实时数据。超时动画为加速演示；健康图示只基于计时，不检测真实坐姿或饮水。

### 桌面收纳

<table>
  <tr>
    <td width="50%" valign="top"><strong>应用收纳：常用应用集中展示</strong><br /><a href="docs/images/gallery/collection-apps.png"><img src="docs/images/gallery/collection-apps.png" alt="应用收纳：常用应用集中展示" width="360" /></a></td>
    <td width="50%" valign="top"><strong>文件收纳：文档和文件夹分类查找</strong><br /><a href="docs/images/gallery/collection-files.png"><img src="docs/images/gallery/collection-files.png" alt="文件收纳：文档和文件夹分类查找" width="360" /></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>图片收纳：素材与灵感一目了然</strong><br /><a href="docs/images/gallery/collection-images.png"><img src="docs/images/gallery/collection-images.png" alt="图片收纳：素材与灵感一目了然" width="360" /></a></td>
    <td width="50%" valign="top"><strong>影音收纳：视频和录音分别归类</strong><br /><a href="docs/images/gallery/collection-media.png"><img src="docs/images/gallery/collection-media.png" alt="影音收纳：视频和录音分别归类" width="360" /></a></td>
  </tr>
</table>

### 待办与日常工具

<table>
  <tr>
    <td width="50%" valign="top"><strong>待办：记录、安排日期和分类查看</strong><br /><a href="docs/images/gallery/todos.png"><img src="docs/images/gallery/todos.png" alt="待办：记录、安排日期和分类查看" width="360" /></a></td>
    <td width="50%" valign="top"><strong>待办详情：安排日期、时间与提醒</strong><br /><a href="docs/images/gallery/todo-reminder.png"><img src="docs/images/gallery/todo-reminder.png" alt="待办详情：安排日期、时间与提醒" width="360" /></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>日历：查看日期与当天日程</strong><br /><a href="docs/images/gallery/calendar.png"><img src="docs/images/gallery/calendar.png" alt="日历：查看日期与当天日程" width="360" /></a></td>
    <td width="50%" valign="top"><strong>便签：把想法与重点留在桌面</strong><br /><a href="docs/images/gallery/notes.png"><img src="docs/images/gallery/notes.png" alt="便签：把想法与重点留在桌面" width="360" /></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>倒数日：重要日期还有多久</strong><br /><a href="docs/images/gallery/countdown.png"><img src="docs/images/gallery/countdown.png" alt="倒数日：重要日期还有多久" width="360" /></a></td>
    <td width="50%" valign="top"><strong>专注计时：留出一段不被打断的时间</strong><br /><a href="docs/images/gallery/focus.png"><img src="docs/images/gallery/focus.png" alt="专注计时：留出一段不被打断的时间" width="360" /></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>时间与时区：同时查看不同城市时间</strong><br /><a href="docs/images/gallery/clock.png"><img src="docs/images/gallery/clock.png" alt="时间与时区：同时查看不同城市时间" width="360" /></a></td>
    <td width="50%" valign="top"><strong>天气：当前天气与未来三天预报</strong><br /><a href="docs/images/gallery/weather.png"><img src="docs/images/gallery/weather.png" alt="天气：当前天气与未来三天预报" width="360" /></a></td>
  </tr>
</table>

### 设备与健康提醒

<table>
  <tr>
    <td width="50%" valign="top"><strong>设备读数：CPU、内存、GPU与网络</strong><br /><a href="docs/images/gallery/devices.png"><img src="docs/images/gallery/devices.png" alt="设备读数：CPU、内存、GPU与网络" width="360" /></a></td>
    <td width="50%" valign="top"><strong>健康面板：水杯当前毫升数与活动计时</strong><br /><a href="docs/images/gallery/health.png"><img src="docs/images/gallery/health.png" alt="健康面板：水杯当前毫升数与活动计时" width="360" /></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>每日目标：保留已喝水量，随时调整目标</strong><br /><a href="docs/images/gallery/health-goal.png"><img src="docs/images/gallery/health-goal.png" alt="每日目标：保留已喝水量，随时调整目标" width="360" /></a></td>
    <td width="50%" valign="top"><strong>超时积水：满水时仍可原位撤销（加速演示）</strong><br /><a href="docs/images/gallery/health-overdue.png"><img src="docs/images/gallery/health-overdue.png" alt="超时积水：满水时仍可原位撤销（加速演示）" width="360" /></a></td>
  </tr>
</table>

### 健康设置

<table>
  <tr>
    <td width="50%" valign="top"><strong>每日喝水计划：按剩余水量与时段安排提醒</strong><br /><a href="docs/images/gallery/settings-health-daily.png"><img src="docs/images/gallery/settings-health-daily.png" alt="每日喝水计划：按剩余水量与时段安排提醒" width="360" /></a></td>
    <td width="50%" valign="top"><strong>固定间隔：用熟悉的节奏喝水与活动</strong><br /><a href="docs/images/gallery/settings-health-fixed.png"><img src="docs/images/gallery/settings-health-fixed.png" alt="固定间隔：用熟悉的节奏喝水与活动" width="360" /></a></td>
  </tr>
</table>

### 外观设置

<table>
  <tr>
    <td width="50%" valign="top"><strong>外观：实时预览透明度、配色与字号</strong><br /><a href="docs/images/gallery/settings-appearance.png"><img src="docs/images/gallery/settings-appearance.png" alt="外观：实时预览透明度、配色与字号" width="360" /></a></td>
    <td width="50%" valign="top"><strong>外观细节：透明度、背景配色、文字颜色与字号</strong><br /><a href="docs/images/gallery/settings-appearance-controls.png"><img src="docs/images/gallery/settings-appearance-controls.png" alt="外观细节：透明度、背景配色、文字颜色与字号" width="360" /></a></td>
  </tr>
</table>

### 桌面设置与数据管理

<table>
  <tr>
    <td width="50%" valign="top"><strong>桌面组件：显隐、显示器与桌面行为</strong><br /><a href="docs/images/gallery/settings-desktop-components.png"><img src="docs/images/gallery/settings-desktop-components.png" alt="桌面组件：显隐、显示器与桌面行为" width="360" /></a></td>
    <td width="50%" valign="top"><strong>桌面行为：吸附、悬停展开和快捷键</strong><br /><a href="docs/images/gallery/settings-desktop-behavior.png"><img src="docs/images/gallery/settings-desktop-behavior.png" alt="桌面行为：吸附、悬停展开和快捷键" width="360" /></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>收纳管理：分类分区、规则与操作预览</strong><br /><a href="docs/images/gallery/settings-desktop-organizer.png"><img src="docs/images/gallery/settings-desktop-organizer.png" alt="收纳管理：分类分区、规则与操作预览" width="360" /></a></td>
    <td width="50%" valign="top"><strong>归档规则：先预览，再决定是否整理</strong><br /><a href="docs/images/gallery/settings-desktop-rules.png"><img src="docs/images/gallery/settings-desktop-rules.png" alt="归档规则：先预览，再决定是否整理" width="360" /></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>布局备份：保存与恢复组件和图标位置</strong><br /><a href="docs/images/gallery/settings-desktop-backups.png"><img src="docs/images/gallery/settings-desktop-backups.png" alt="布局备份：保存与恢复组件和图标位置" width="360" /></a></td>
    <td width="50%" valign="top"><strong>数据与隐私：本地保存、导入与导出</strong><br /><a href="docs/images/gallery/settings-desktop-data.png"><img src="docs/images/gallery/settings-desktop-data.png" alt="数据与隐私：本地保存、导入与导出" width="360" /></a></td>
  </tr>
</table>

## 从源码运行

技术栈：Electron、Vue 3、TypeScript 与 C# 原生桌面桥接。

需要 Windows x64、Node.js 22 LTS（附 npm）、Windows 自带的 .NET Framework 4.x C# 编译器。首次安装依赖和打包需要网络。

```powershell
git clone https://github.com/Gerson369/windows-desktop-widgets.git
cd windows-desktop-widgets
npm ci
npm run build:native
npm run dev
```

验证和构建：

```powershell
npm run typecheck
npm test
npm run build
npm run dist:windows
```

`dist:windows` 会编译两个原生桥，生成 Windows x64 安装版和免安装版到 `release/`。原生二进制、依赖、构建输出及本机测试数据不提交到仓库。

## 项目结构

```text
src/main/         Electron 主进程、本地数据、桌面与提醒逻辑
src/preload/      隔离的 IPC 接口
src/renderer/     Vue 界面与桌面组件
native/           C# 桌面挂接及布局桥接源码
scripts/          构建与隔离交互验证工具
tests/            单元测试、契约与数据保护测试
```

## 数据与边界

- 待办、便签、计划、饮水记录、置顶和布局保存在本机。导出的配置可能包含便签正文、文件路径和私人日历订阅地址，请妥善保管，勿提交到公共仓库。
- 天气使用 Open-Meteo，仅发送选择的城市坐标，不读取自动定位；日历订阅访问你自己添加的地址。天气接口有服务与商业使用条款，商业使用前请确认相应许可。
- 日历订阅为只读合并展示；导入 ICS 文件后，如原文件变化，需要重新导入。
- GPU、网络和电池读数受 Windows 与设备支持程度影响。健康提醒基于计时，无法判断是否真的喝水或起身。
- 工作区过小时可能无法容纳贴靠组合，可将健康面板拖开单独摆放。

此仓库不包含个人配置、凭据、桌面文件清单、第三方桌面软件拆包或本机测试记录。构建输出和本地验证资料不作为源码提交。

## 验证范围

v2.6.17 已通过 **132 项单元与契约测试**、类型检查和生产构建；安装包版本、构建文件一致性与 SHA256 已校验。隔离的真实 Electron 窗口检查覆盖：

- 300 / 360 / 420px 宽度下五栏等宽、名称与数量分行、五位数量不溢出，分类栏保持 33px。
- 全部分类拖入自动归类、跨分类置顶、双击打开流程、重启保留及取消置顶。
- 11:00 开始时的 56ml 满杯与 28ml 半杯记录、数据保存、喝水与活动独立撤销、过期和同类新操作替换。
- 缺少或错误的旧吸附记录下，启动及重启后首次展开、收起和重复展开时健康面板跟随。

本轮未实测安装向导覆盖升级、真实多屏热插拔、系统鼠标拖边和长时间连续运行。

## 反馈与贡献

遇到问题可在 [Issues](https://github.com/Gerson369/windows-desktop-widgets/issues) 提交 Windows 版本、软件版本、操作步骤、预期与实际结果，并附必要截图。截图和附件请先检查是否包含私人内容，勿直接上传完整个人配置。

提交代码前请运行上方验证命令；界面或交互改动可参考 `tests/` 与 `scripts/` 中的隔离检查。

## 许可证

[MIT](LICENSE)。依赖及第三方服务遵循各自许可证和服务条款。
