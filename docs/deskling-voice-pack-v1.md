# Deskling 音色包 v1

Deskling 不定义新的神经网络或权重格式。音色包只是现成
`sherpa-onnx OfflineTts` 模型外面的一层轻量清单，用来说明模型文件、
引擎家族和说话人编号。ONNX、tokens、词典与声码器文件保持原样。

## 用户导入

桌宠设置的“嗓音”区域支持两种入口：

- **导入模型目录**：直接选择已解压的 sherpa-onnx TTS 模型目录。
  若目录没有清单，Deskling 会根据典型文件名自动识别 Kokoro、
  VITS/Melo 或 Matcha，并生成清单。
- **导入 ZIP 音色包**：选择 `.zip` 或 `.deskling-voice` 文件。压缩包可在
  根目录放资源，也可只包含一个顶层文件夹。

导入时 Deskling 会复制文件到应用数据目录、校验所有包内路径，并实际创建
一次 TTS 引擎。安装成功后才会出现在桌宠的音色下拉框中。

目前直接支持的是 sherpa-onnx 的 OfflineTts 模型。Piper、GPT-SoVITS、
Fish Speech、RVC 或其他框架的权重不是同一种推理接口，后续需要各自的
运行时适配器，不能仅靠改扩展名导入。

## 清单

准备给创意工坊分发时，可在模型根目录提供 `manifest.json`：

```json
{
  "schemaVersion": 1,
  "kind": "voice",
  "id": "author.character.zh",
  "name": "角色中文音色",
  "engine": "kokoro",
  "version": "1.0.0",
  "author": "作者名",
  "license": "模型许可证",
  "files": {
    "model": "model.int8.onnx",
    "voices": "voices.bin",
    "tokens": "tokens.txt",
    "dataDir": "espeak-ng-data",
    "dictDir": "dict",
    "lexicon": "lexicon-us-en.txt,lexicon-zh.txt",
    "ruleFsts": "phone.fst,date.fst,number.fst"
  },
  "voices": [
    { "id": 0, "name": "默认音色", "lang": "zh-CN" }
  ]
}
```

`voices` 可以省略或留空。Deskling 会读取模型的说话人数并生成
“默认音色”或“音色 1、音色 2……”条目。若希望在 UI 里显示角色名与语言，
则应由包作者显式填写。

### 引擎与必需文件角色

| `engine` | 必需角色 | 常用可选角色 |
| --- | --- | --- |
| `kokoro` | `model`、`voices`、`tokens` | `dataDir`、`dictDir`、`lexicon`、`ruleFsts` |
| `vits` / `melo` | `model`、`tokens` | `dataDir`、`dictDir`、`lexicon` |
| `matcha` | `acousticModel`、`vocoder`、`tokens` | `dataDir`、`dictDir`、`lexicon`、`ruleFsts` |

文件值必须是使用 `/` 的包内相对路径。`lexicon` 与 `ruleFsts` 可用英文逗号
声明多个文件。绝对路径、`..`、盘符、URL、反斜杠和指向包外的链接都会被拒绝。

## 分发建议

- 模型许可证由音色包作者负责声明；Deskling 不替模型重新授权。
- 优先提供量化 ONNX（例如 int8），可以明显缩短首次加载并减小包体。
- 把许可证原文一起放进包内，`license` 写许可证名称或 SPDX 标识。
- ZIP 解压上限为 6GB、文件数上限为 20,000，且不允许符号链接。
