// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WindowEvent,
};

mod memory;
mod provider;
mod skills;
mod stt;
mod tools;
mod tts;
mod wake;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 从托盘唤回主窗口：显示 + 取消最小化 + 聚焦
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn hide_tray_menu(app: &AppHandle) {
    if let Some(menu) = app.get_webview_window("tray-menu") {
        let _ = menu.hide();
    }
}

/// 在鼠标位置弹出自绘像素托盘菜单窗（替代系统原生菜单）。
/// 菜单窗左下角锚在光标上：托盘在屏幕右下角，菜单向左上展开，天然不越界；
/// clamp 到 (0,0) 兜底任务栏在顶部/左侧的布局。
fn show_tray_menu(app: &AppHandle, cursor: PhysicalPosition<f64>) {
    if let Some(menu) = app.get_webview_window("tray-menu") {
        // 前端挂载后会按内容自适应窗口尺寸，这里读当前实际尺寸来定位
        let size = menu.outer_size().unwrap_or(PhysicalSize::new(200, 110));
        let x = cursor.x.max(0.0);
        let y = (cursor.y - size.height as f64).max(0.0);
        let _ = menu.set_position(PhysicalPosition::new(x, y));
        let _ = menu.show();
        // 聚焦后由前端「失焦即隐藏」实现点击外部关闭（与原生菜单手感一致）
        let _ = menu.set_focus();
    }
}

/// 托盘菜单项：显示主界面（先收起菜单窗再唤主窗）
#[tauri::command]
fn tray_show_main(app: AppHandle) {
    hide_tray_menu(&app);
    show_main_window(&app);
}

/// 托盘菜单项：真正退出应用
#[tauri::command]
fn tray_quit(app: AppHandle) {
    app.exit(0);
}

/// 切换某个窗口的显示/隐藏，返回切换后的可见状态（true=现在可见）。
/// 供桌宠 / 对话窗的 toggle 复用：可见则隐藏，隐藏则显示并聚焦。
fn toggle_window(app: &AppHandle, label: &str) -> bool {
    if let Some(win) = app.get_webview_window(label) {
        // is_visible 失败时保守当作不可见，走「显示」分支
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            false
        } else {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
            true
        }
    } else {
        false
    }
}

/// 查询某窗口当前是否可见（供前端按钮初始化文案 / 状态）。
fn window_visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// 切换桌宠窗口显示/隐藏（Pet 页按钮 / 后续托盘入口共用）。返回切换后是否可见。
#[tauri::command]
fn pet_toggle(app: AppHandle) -> bool {
    toggle_window(&app, "pet")
}

/// 切换 AI 对话窗口显示/隐藏。返回切换后是否可见。
#[tauri::command]
fn chat_toggle(app: AppHandle) -> bool {
    toggle_window(&app, "chat")
}

/// 显式唤出 AI 对话窗（点击桌宠说话气泡等入口：只显示并聚焦，不做 toggle——
/// 已经开着时再点不能反而把窗口藏了）。
#[tauri::command]
fn chat_show(app: AppHandle) {
    if let Some(win) = app.get_webview_window("chat") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 前端图片预览：读本地图片转 data URL（作曲区附件缩略图 / 消息气泡展示）。
/// 上限 20MB——再大的原图别整个搬进 WebView 内存，直接报错让前端显示占位
#[tauri::command]
fn image_preview(path: String) -> Result<String, String> {
    let mime = provider::image_mime(&path).ok_or("不支持的图片格式")?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("读取失败: {e}"))?;
    const PREVIEW_MAX_BYTES: u64 = 20 * 1024 * 1024;
    if meta.len() > PREVIEW_MAX_BYTES {
        return Err("图片过大（>20MB），不做预览".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("读取失败: {e}"))?;
    use base64::Engine as _;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// 附件把关：图片加入附件条之前校验（存在 + ≤5MB + 文件头是支持的格式）。
/// 与发送路径同一套标准——UI 收下的图就一定送得出去，不做「显示已发、
/// 模型没见着」的两面派
#[tauri::command]
fn image_probe(path: String) -> Result<(), String> {
    provider::probe_image(&path)
}

/// 系统级查询鼠标主键是否按住。OS 拖窗的模态循环期间网页收不到指针事件，
/// 桌宠窗的移动停表用它区分「拖到屏幕边顶住不动」和「已经松手」——按住就
/// 保持悬空动画并推迟落点校正。两个键都查，兼容系统级左右键互换的用户
#[tauri::command]
fn mouse_pressed() -> bool {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON,
        };
        GetAsyncKeyState(VK_LBUTTON as i32) < 0 || GetAsyncKeyState(VK_RBUTTON as i32) < 0
    }
    #[cfg(not(windows))]
    false
}

/// 设置代理偏好（设置页「代理」区改动 + 启动时推来）：mode = system/custom/off，
/// custom 时 url = 代理地址。存进 tools 全局，run_command 派生命令时按它设代理环境。
#[tauri::command]
fn set_proxy(mode: String, url: String) {
    tools::set_proxy_pref(mode, url);
}

/// 查询桌宠 / 对话窗口当前可见状态（前端挂载时同步按钮文案用）。
#[tauri::command]
fn pet_visible(app: AppHandle) -> bool {
    window_visible(&app, "pet")
}

#[tauri::command]
fn chat_visible(app: AppHandle) -> bool {
    window_visible(&app, "chat")
}

/// 创建系统托盘：左键单击唤回主窗口，右键弹出自绘像素菜单（tray-menu 窗口）。
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().expect("app icon missing").clone())
        .tooltip("Deskling")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                match button {
                    MouseButton::Left => show_main_window(tray.app_handle()),
                    MouseButton::Right => show_tray_menu(tray.app_handle(), position),
                    _ => {}
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例守卫（须注册在最前）：点 X 是藏进托盘不退出，用户很容易再双击
        // 快捷方式开出第二个进程——两个进程各持一份内存态互相覆写 memory.json
        // 与设置存储。二次启动不开新进程，只把已有实例的主窗口唤出来
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // 语音输入全局状态：录音会话 + 常驻 SenseVoice 识别器
        .manage(stt::SttState::default())
        // 语音输出全局状态：语音包缓存 + 合成/播放运行时（首次 tts_speak 拉起）
        .manage(tts::TtsState::default())
        // 语音唤醒全局状态：常驻监听管线（wake_configure 按设置拉起/重建）
        .manage(wake::WakeState::default())
        .setup(|app| {
            setup_tray(app)?;
            // 长期记忆：加载 app_data_dir/memory.json（remember 工具写、
            // provider 注入 system prompt、设置页管理、变更广播刷新 UI）
            memory::init(app.handle().clone());
            Ok(())
        })
        // 默认行为：点 X 不退出，隐藏到系统托盘（真正退出走托盘菜单「退出」）
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            tray_show_main,
            tray_quit,
            pet_toggle,
            chat_toggle,
            chat_show,
            pet_visible,
            chat_visible,
            mouse_pressed,
            image_preview,
            image_probe,
            set_proxy,
            provider::provider_test,
            provider::provider_chat,
            provider::provider_chat_cancel,
            provider::provider_tool_approve,
            stt::stt_devices,
            stt::stt_start,
            stt::stt_partial,
            stt::stt_stop,
            stt::stt_cancel,
            tts::tts_packs,
            tts::tts_output_devices,
            tts::tts_speak,
            tts::tts_beep_start,
            tts::tts_stop,
            tts::tts_set_volume,
            wake::wake_configure,
            wake::wake_chat_busy,
            memory::memory_list,
            memory::memory_remove,
            memory::memory_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
