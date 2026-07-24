# Live2D 运行与验收

## 运行边界

Deskling 的 Live2D 支持已经进入正式构建：

- 开发版与生产版都启用 `live2d-cubism` 渲染器；
- `live2dcubismcore.min.js` 作为 Tauri resource 随安装包分发；
- 像素桌宠仍按需加载，不会启动 Pixi/Cubism WebGL chunk；
- 工坊模型包不得携带或覆盖 Core。

Core 文件头将其标记为 Live2D 协议中的 Redistributable Code；具体产品分发仍按
Deskling 实际商业规模与 Live2D 的适用条款处理。

## 准备 Core

无需准备，Deskling 会优先使用安装包内置 Core。桌宠页的“Live2D 运行时”区域
仍支持选择官方 SDK `Core` 目录里的 `live2dcubismcore.min.js`，用于临时覆盖和
测试新版 Core；点击“恢复内置”即可删除覆盖文件。

## 准备模型包

把包含 `manifest.json` 的完整目录放进 Deskling 应用数据目录下的 `petpacks/`，然后
完全重启 Deskling。最小结构：

```text
com.example.live2d-pet/
├─ manifest.json
├─ preview/icon.png
├─ appearance/model/model.model3.json
├─ appearance/model/model.moc3
├─ appearance/model/textures/*.png
└─ licenses/NOTICE.txt
```

清单示例见 [Deskling Pet Package v1](deskling-pet-package-v1.md#live2d-cubism)。
扫描器会逐项验证 model3 引用；缺失文件、URL、绝对路径和 `../` 都会让整个包进入
invalid 状态，不会把残缺模型交给 WebGL。

重启后，资源包会自动生成一个桌宠实例。打开该桌宠的设置面板，点击“设为当前桌宠”，
桌宠窗口会即时切换，无需再次重启。

## 动作映射验收

在桌宠页的动画测试区依次检查：

1. `idle` 能持续循环且眨眼/物理正常；
2. `摸头` 播放映射的 Motion，结束后回到 idle；
3. `说话`、`思考`、`聆听` 等持续状态不会在单条 Motion 结束后卡住；
4. `走路` 随窗口移动持续播放，停下后回 idle；
5. 缺少某个语义映射时只回退到模型已有的常见 Motion，不出现空白画布；
6. Core 或模型加载失败时持续展示 `preview.icon`，桌宠仍可拖动和召回。
