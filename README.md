# Windows Desktop Widgets · Windows 桌面小组件与收纳助手

Gerson Desktop Widgets 是一个面向 **Windows 10 / 11 x64** 的桌面整理和效率工具，使用 Electron、Vue 3、TypeScript 与 C# 原生桌面桥接。

**Windows desktop widgets, desktop organizer, todo list, weather, countdown days and wellness reminders.**

[下载最新版 / Download](https://github.com/Gerson369/windows-desktop-widgets/releases/latest) · [反馈问题 / Issues](https://github.com/Gerson369/windows-desktop-widgets/issues)

## 功能

- **桌面收纳与自动分类**：应用、文件、图片、影音分类，搜索、排序与拖动吸附；保留原文件，退出恢复原桌面图标。
- **待办清单**：待办、今天、计划、已完成四类，数量独立显示；创建日期与安排日期分开，支持文字输入日期、整月日历、提醒与原地改名。
- **综合助手**：秒级时钟、多地天气、体感/湿度/风速与设备读数集中显示，点击相应区域调整；日历、便签、倒数日和专注按需切换。
- **喝水与久坐提醒**：每日水量、平均分配或自定义每杯时间；一键记录、15 秒撤销、锁屏暂停。水杯溢水、积水和骨节松动掉落带重力效果。
- **紧凑设置**：常用间隔和水量直接点选，自动保存；主题颜色、透明度、布局与显示器可调整。
- **本地数据**：待办、便签、计划和布局保存在本机，支持配置导入导出。

<p align="center"><img src="docs/images/overview.png" alt="Windows desktop widgets: todo list, clock, weather and device overview" width="360" /></p>

截图使用演示事项和固定天气、设备样本，并非实时数据。

## 安装

在 [Releases](https://github.com/Gerson369/windows-desktop-widgets/releases/latest) 下载：

- `setup.exe`：安装版。
- `portable.exe`：免安装版。

更新前从系统托盘退出旧版，再打开新版。请通过托盘退出以便恢复桌面图标；隐藏面板不等于退出程序。未配置代码签名，Windows 可能显示发布者提示。

## 从源码运行

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

天气使用 Open-Meteo，仅发送选择的城市坐标，不读取自动定位；日历订阅访问你自己添加的地址。天气接口有服务与商业使用条款，商业使用前请确认相应许可。GPU、网络和电池读数受 Windows 与设备支持程度影响；健康图示仅基于计时，不能检测真实坐姿或饮水。

导出的配置可能包含私人便签、文件路径和日历订阅地址，请勿提交到公共仓库。此仓库不包含个人配置、凭据、桌面文件清单、第三方桌面软件拆包或本机测试记录。

当前版本：**2.4.0**。单元及契约测试 79 项通过；界面交互在隔离 Windows 实例验证。多屏、特殊桌面环境和长时间运行仍需要更多设备验证。

## 许可证

[MIT](LICENSE)。依赖及第三方服务遵循各自许可证和服务条款。
