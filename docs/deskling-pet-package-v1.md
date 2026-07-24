# Deskling Pet Package v1

桌宠资源包把外观、人设与默认音色声明在一份只读清单里；用户改名、改人设或换
音色时，Deskling 只修改独立的 `PetInstance`，不会回写资源包。这样工坊更新包时
不会覆盖用户配置。

## 目录约定

```text
com.example.pet/
├─ manifest.json
├─ preview/
│  ├─ icon.png
│  └─ cover.png
├─ appearance/
│  ├─ anim/*.png              # sprite-sheet
│  └─ model/model.model3.json # live2d-cubism
├─ persona/system.md
└─ licenses/NOTICE.txt
```

- 内置包：`src-tauri/resources/pets/<package>/`
- 用户/工坊包：`app_data_dir/petpacks/<package>/`
- 将来的安装文件扩展名为 `.deskling-pet`，本质是上述目录的归档；v1 扫描器当前
  读取安装后目录，归档导入器另行接入。
- 清单中所有文件路径必须使用 `/` 分隔的包内相对路径。绝对路径、URL、`..`、
  反斜杠以及指向包外的软链接都会被拒绝。

## 最小清单

```json
{
  "schemaVersion": 1,
  "kind": "pet",
  "id": "com.example.pet",
  "version": "1.0.0",
  "name": "示例桌宠",
  "author": { "name": "作者" },
  "license": { "name": "许可证", "file": "licenses/NOTICE.txt" },
  "preview": { "icon": "preview/icon.png" },
  "components": {
    "appearance": {
      "type": "sprite-sheet",
      "frame": { "width": 32, "height": 32, "scale": 6 },
      "layout": { "groundY": 29 },
      "animations": {
        "idle": [
          {
            "src": "appearance/anim/idle.png",
            "frames": 12,
            "fps": 5,
            "loop": true
          }
        ]
      }
    },
    "persona": { "promptFile": "persona/system.md" },
    "voice": {
      "packId": "voice-pack-id",
      "voiceId": 0,
      "speed": 1,
      "enabledByDefault": false
    }
  }
}
```

`sequence` 可省略，省略后按 `0..frames-1` 顺播；同一状态可以声明多个变体，
每次进入状态时随机选择一整套。除 `idle` 外的语义状态暂时都可省略，播放器会
使用同一资源包的 `idle` 安全兜底，不会混入其他桌宠的图像。

## 外观类型

### `sprite-sheet`

当前可播放。帧带横向排列，单帧尺寸来自 `frame`；`scale` 是桌面显示倍率，
`layout.groundY` 是脚底在源帧中的 Y 坐标，用于底边召回与任务栏对齐。

### `live2d-cubism`

v1 清单会校验 `.model3.json` 及其中标准引用的 Moc、纹理、Physics、Pose、表情、
动作和动作音频。所有引用必须留在当前包内：

```json
{
  "type": "live2d-cubism",
  "entry": "appearance/model/model.model3.json",
  "frame": { "width": 240, "height": 300, "scale": 1 },
  "layout": {
    "groundY": 294,
    "modelScale": 0.92,
    "offsetX": 0,
    "offsetY": 0
  },
  "motions": {
    "idle": [{ "group": "Idle", "loop": true }],
    "petted": [
      { "group": "TapBody", "index": 0, "next": "idle" }
    ],
    "talking": [{ "group": "Talk", "loop": true }],
    "success": [
      {
        "group": "TapBody",
        "expression": "smile",
        "durationMs": 1800,
        "next": "idle"
      }
    ]
  }
}
```

`frame`/`layout` 可同时省略，默认使用 `240×240` 透明画布、`groundY=236`。
`modelScale` 是等比适配后的二次缩放，`offsetX/Y` 是逻辑像素偏移。`motions` 的
key 与像素桌宠语义状态一致；同一状态可声明多个变体，进入时随机抽一个。`group`
大小写会自动匹配 model3 中实际分组；未声明时会尝试 `Idle`、`TapBody`、`Walk`
等常见名，仍建议工坊作者显式映射。

Cubism Core 属于 Live2D 的专有组件，由 Deskling 安装包统一提供并在需要时加载。
公共包格式只保留模型适配入口，不允许模型包捆绑 Core；这样所有桌宠共享同一个
经过校验的运行时，也避免工坊资源覆盖全局 `Live2DCubismCore`。

### `inochi2d`

开放的实时 2D 木偶格式，入口指向 `.inp` 或 `.inx`：

```json
{
  "type": "inochi2d",
  "entry": "appearance/model/model.inp"
}
```

该类型用于不依赖 Cubism 专有运行时的动态桌宠。当前清单和引擎分发接口已经
识别它，实际 Inochi2D Renderer 在后续阶段接入。

## 配置分层

```text
PetPackage（只读）
  ├─ appearance
  ├─ persona prompt
  └─ default voice binding

PetInstance（用户设置）
  ├─ packageId
  ├─ nameOverride
  ├─ promptOverride
  ├─ voiceOverride
  └─ previewOverride（旧版/丢包兜底）
```

旧版 `settings.petProfiles` 会在首次启动时迁移为 `petInstances`。旧键暂留作一个
版本的回滚保险，运行时不再读取或写入。
