# 桌宠渲染器架构与许可边界

## 决策

Deskling 使用“一套行为控制器，多套外观渲染器”：

```text
PetWindow（桌面行为控制器）
├─ 对话状态、拖拽、散步、睡眠
├─ 任务栏保护、四边隐藏、气泡
└─ PetRenderer（按 appearance.type 分发）
   ├─ SpriteSheetRenderer
   ├─ Live2DCubismRenderer（正式内置，Core 随安装包分发）
   └─ Inochi2DRenderer（开放格式，待接入）
```

资源包的 `components.appearance.type` 是渲染器类型的唯一事实来源：

- `sprite-sheet`
- `live2d-cubism`
- `inochi2d`

`PetInstance` 只保存 `packageId` 和用户覆盖项，不重复持久化类型。UI 使用的
`PetProfile.appearanceType` 是从资源包派生的只读字段，避免“实例说是像素、包里
却是 Live2D”这类配置分裂。

所有渲染器接收统一的语义状态（例如 `idle`、`talking`、`walkingLeft`），并向
控制器上报：

- 已真正显示的状态；
- 一次性动作结束及其声明式后继状态；
- 当前模型的可交互矩形。

图片帧、Cubism Motion 或 Inochi2D Animation 如何实现这些语义，属于各自引擎，
不得回流进 `PetWindow`。

## Live2D Cubism 许可边界

Live2D 官方把可以通过增加/组合文件使用不特定数量模型的作品归为
“Expandable Application”。Deskling 的创意工坊符合这一技术特征，实际分发时
由产品所有者按届时商业规模与 Live2D 最新条款确认适用方案；运行时架构不把
“Core 外置”当成规避许可的手段。

- 官方发布许可：https://www.live2d.com/en/sdk/license/
- Expandable Application：https://www.live2d.com/en/sdk/license/expandable/
- Cubism Core 说明：https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/

当前实现边界：

1. Cubism Core 作为 Deskling 自身的 Tauri resource 随安装包统一分发。
2. 不把第三方 Web wrapper 当成 Core；加载 `.moc3` 时仍使用 Live2D 专有运行时。
3. 创意工坊模型包不能携带 Core，也不能覆盖全局运行时。
4. 用户可在桌宠面板安装外部 Core 覆盖内置版本，用于 SDK 升级测试，并可一键恢复。
5. 开发构建与正式构建使用相同渲染路径，避免只在发布产物里出现集成差异。

渲染实现使用按需加载的 PixiJS 8 与 `untitled-pixi-live2d-engine/cubism`，覆盖
Cubism 3/4/5，并使用 Pixi 8 原生 Render Pipe。像素桌宠不会加载这些 WebGL chunk；
Core 和模型加载完成前保留资源包预览图，连续输出两帧后再切换，避免桌宠出现空白帧。

## 开放方案

Inochi2D SDK 与格式采用 BSD-2-Clause，可用于免集成许可费的实时 2D 木偶引擎：

- 官方 SDK：https://github.com/Inochi2D/inochi2d
- 官方许可 FAQ：https://docs.inochi2d.com/en/latest/inochi2d/faq.html

它不能直接读取 Live2D 模型；已有 `.moc3` 资产需要从原始分层图重新绑定。因此
Deskling 会把 Inochi2D 作为开放动态桌宠路线，而不是宣称它是 Live2D 转换器。
