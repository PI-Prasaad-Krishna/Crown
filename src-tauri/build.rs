fn main() {
    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        if let Ok(out_dir) = std::env::var("OUT_DIR") {
            for name in ["libresource.a", "resource.lib"] {
                let res_path = std::path::Path::new(&out_dir).join(name);
                if res_path.exists() {
                    println!("cargo:rustc-link-arg-tests={}", res_path.display());
                    break;
                }
            }
        }
    }
}
