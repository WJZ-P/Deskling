# 桌宠渲染器架构与许可边界

## 决策

Deskling 使用“一套行为控制器，多套外观渲染器”：

```text
PetWindow（桌面行为控制器）
├─ 对话状态、拖拽、散步、睡眠
├─ 任务栏保护、四边隐藏、气泡
└─ PetRenderer（按 appearance.type 分发）
   ├─ SpriteSheetRenderer
   ├─ Live2DCubismRenderer（许可控制，未随默认构建提供）
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
“Expandable Application”。Deskling 的创意工坊符合这一特征，因此发布包含
Cubism SDK/Core 的版本前需要向 Live2D 申请审核并签署专项出版许可；个人和小型
开发者也不在普通豁免范围内。

- 官方发布许可：https://www.live2d.com/en/sdk/license/
- Expandable Application：https://www.live2d.com/en/sdk/license/expandable/
- Cubism Core 说明：https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/

默认发行版遵守以下硬边界：

1. 不把 Cubism Core 或其下载产物提交进仓库、npm 包或安装包。
2. 不把第三方 Web wrapper 当成许可替代品；只要实际加载 `.moc3`，仍依赖专有 Core。
3. `live2d-cubism` 清单可以被扫描和展示，但没有获批的 Renderer 时必须标记为
   unavailable，不能暗中降级到另一套模型解析代码。
4. 将来只有获得与 Deskling 分发方式相符的书面许可后，才发布 Cubism Renderer。

## 开放方案

Inochi2D SDK 与格式采用 BSD-2-Clause，可用于免集成许可费的实时 2D 木偶引擎：

- 官方 SDK：https://github.com/Inochi2D/inochi2d
- 官方许可 FAQ：https://docs.inochi2d.com/en/latest/inochi2d/faq.html

它不能直接读取 Live2D 模型；已有 `.moc3` 资产需要从原始分层图重新绑定。因此
Deskling 会把 Inochi2D 作为开放动态桌宠路线，而不是宣称它是 Live2D 转换器。
