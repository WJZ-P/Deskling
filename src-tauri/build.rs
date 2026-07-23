fn main() {
    #[cfg(target_os = "windows")]
    {
        // Tauri's Windows dependencies import TaskDialogIndirect from Common Controls v6.
        // The application binary gets a manifest from Tauri, but Rust's unit-test binary
        // does not. Feed the linker an additional manifest so tests can start on Windows.
        let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let manifest = out_dir.join("common-controls-v6.manifest");
        std::fs::write(
            &manifest,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#,
        )
        .unwrap();

        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());

        // The same manifest is now supplied directly to link.exe, so omit the
        // copy that tauri-build would otherwise place in resource.lib. Keeping
        // only one source avoids duplicate RT_MANIFEST resources in app targets.
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("failed to run tauri build script");
    }

    #[cfg(not(target_os = "windows"))]
    tauri_build::build()
}
