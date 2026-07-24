//! Live2D Cubism Core 运行时管理。
//!
//! Deskling 安装包内置一份经过校验的 Core，确保正式构建开箱即用；用户仍可从
//! 官方 Cubism SDK 导入新版 Core 到 app_data_dir/runtimes/live2d 进行覆盖。
//! 创意工坊模型包不得携带 Core，避免不同包各自注入一份全局运行时。

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{path::BaseDirectory, AppHandle, Manager, WebviewWindow};

const CORE_FILE: &str = "live2dcubismcore.min.js";
const BUNDLED_CORE: &str = "resources/live2d/live2dcubismcore.min.js";
const CORE_MIN_BYTES: usize = 16 * 1024;
const CORE_MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Live2DCoreStatus {
    installed: bool,
    source: String,
    override_installed: bool,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn override_core_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {error}"))?
        .join("runtimes")
        .join("live2d")
        .join(CORE_FILE))
}

fn bundled_core_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(BUNDLED_CORE, BaseDirectory::Resource)
        .map_err(|error| format!("无法定位内置 Cubism Core: {error}"))
}

fn validate_core(bytes: &[u8]) -> Result<&str, String> {
    if !(CORE_MIN_BYTES..=CORE_MAX_BYTES).contains(&bytes.len()) {
        return Err(format!(
            "Cubism Core 大小异常（应为 16KB-8MB，收到 {:.1}KB）",
            bytes.len() as f64 / 1024.0
        ));
    }
    let source =
        std::str::from_utf8(bytes).map_err(|_| "Cubism Core 文件不是有效 UTF-8 JavaScript")?;
    if source.contains('\0')
        || !source.contains("Live2DCubismCore")
        || !source.contains("csmGetVersion")
    {
        return Err("文件不像官方 live2dcubismcore.min.js".into());
    }
    Ok(source)
}

fn read_core_file(path: &Path, label: &str) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("{label}不存在")
        } else {
            format!("无法读取{label}: {error}")
        }
    })?;
    validate_core(&bytes)?;
    Ok(bytes)
}

fn read_valid_core(app: &AppHandle) -> Result<(&'static str, PathBuf, Vec<u8>), String> {
    let override_path = override_core_path(app)?;
    if override_path.is_file() {
        if let Ok(bytes) = read_core_file(&override_path, "外部 Cubism Core") {
            return Ok(("override", override_path, bytes));
        }
    }

    let bundled_path = bundled_core_path(app)?;
    let bytes = read_core_file(&bundled_path, "内置 Cubism Core")?;
    Ok(("bundled", bundled_path, bytes))
}

#[tauri::command]
pub fn live2d_core_status(app: AppHandle) -> Live2DCoreStatus {
    let override_path = override_core_path(&app).ok();
    let override_installed = override_path.as_ref().is_some_and(|path| path.is_file());
    let override_error = override_path.as_ref().and_then(|path| {
        path.is_file()
            .then(|| read_core_file(path, "外部 Cubism Core").err())
            .flatten()
    });

    match read_valid_core(&app) {
        Ok((source, path, bytes)) => Live2DCoreStatus {
            installed: true,
            source: source.into(),
            override_installed,
            path: path.to_string_lossy().into_owned(),
            size_bytes: Some(bytes.len() as u64),
            error: override_error.map(|error| format!("{error}；已回退到内置版本")),
        },
        Err(error) => {
            let path = bundled_core_path(&app)
                .or_else(|_| override_core_path(&app))
                .unwrap_or_default();
            Live2DCoreStatus {
                installed: false,
                source: "missing".into(),
                override_installed,
                path: path.to_string_lossy().into_owned(),
                size_bytes: std::fs::metadata(&path).ok().map(|item| item.len()),
                error: Some(error),
            }
        }
    }
}

/// 主窗口通过二进制 IPC 导入 Core；不接受任意文件路径，避免把文件选择变成读取接口。
#[tauri::command]
pub fn live2d_core_install(
    app: AppHandle,
    webview: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<Live2DCoreStatus, String> {
    if webview.label() != "main" {
        return Err("只有设置面板可以导入 Cubism Core".into());
    }
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        _ => return Err("Cubism Core 必须使用二进制方式导入".into()),
    };
    validate_core(bytes)?;

    let path = override_core_path(&app)?;
    let parent = path.parent().ok_or("Cubism Core 目录无效")?;
    std::fs::create_dir_all(parent).map_err(|error| format!("无法创建运行时目录: {error}"))?;
    let temp = parent.join(format!("{CORE_FILE}.tmp-{}", std::process::id()));
    let backup = parent.join(format!("{CORE_FILE}.backup-{}", std::process::id()));
    std::fs::write(&temp, bytes).map_err(|error| format!("无法写入 Cubism Core: {error}"))?;
    if path.exists() {
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(&path, &backup)
            .map_err(|error| format!("无法备份旧 Cubism Core: {error}"))?;
    }
    if let Err(error) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        if backup.exists() {
            let _ = std::fs::rename(&backup, &path);
        }
        return Err(format!("无法安装 Cubism Core: {error}"));
    }
    let _ = std::fs::remove_file(&backup);
    Ok(live2d_core_status(app))
}

#[tauri::command]
pub fn live2d_core_remove(
    app: AppHandle,
    webview: WebviewWindow,
) -> Result<Live2DCoreStatus, String> {
    if webview.label() != "main" {
        return Err("只有设置面板可以移除 Cubism Core".into());
    }
    let path = override_core_path(&app)?;
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("无法移除 Cubism Core: {error}")),
    }
    Ok(live2d_core_status(app))
}

/// 仅桌宠 WebView 能拿到脚本文本；主窗口只管理文件，不执行专有运行时。
#[tauri::command]
pub fn live2d_core_source(app: AppHandle, webview: WebviewWindow) -> Result<String, String> {
    if webview.label() != "pet" {
        return Err("Cubism Core 只允许桌宠渲染窗口加载".into());
    }
    let (_, _, bytes) = read_valid_core(&app)?;
    String::from_utf8(bytes).map_err(|_| "Cubism Core 文件不是有效 UTF-8 JavaScript".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_core() -> Vec<u8> {
        let mut source =
            "var Live2DCubismCore={Version:{csmGetVersion:function(){return 1;}}};".repeat(300);
        source.push_str("// official-sdk-placeholder");
        source.into_bytes()
    }

    #[test]
    fn accepts_expected_core_markers() {
        assert!(validate_core(&mock_core()).is_ok());
    }

    #[test]
    fn rejects_arbitrary_javascript() {
        let source = "console.log('not core');".repeat(1000);
        assert!(validate_core(source.as_bytes()).is_err());
    }

    #[test]
    fn accepts_bundled_core() {
        let bundled = include_bytes!("../resources/live2d/live2dcubismcore.min.js");
        assert!(validate_core(bundled).is_ok());
    }
}
