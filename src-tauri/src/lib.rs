// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WindowEvent,
};

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
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app)?;
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
            pet_visible,
            chat_visible
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
