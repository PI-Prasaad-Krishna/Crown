// Crown Browser — Hardware-Backed Hybrid Local Vault (Zero-Knowledge Engine)
// Implements AES-256-GCM authenticated encryption, hardware master key extraction, and Zeroize memory hygiene.
use ring::aead::{
    Aad, BoundKey, Nonce, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM,
    NONCE_LEN,
};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use zeroize::Zeroize;

const VAULT_AAD: &[u8] = b"crown-vault-v1";
#[cfg(target_os = "windows")]
const DPAPI_KEY_PREFIX: &str = "CROWN-DPAPI-V1:";
#[cfg(any(target_os = "macos", target_os = "linux"))]
const KEYRING_SERVICE: &str = "com.crown.browser";
#[cfg(any(target_os = "macos", target_os = "linux"))]
const KEYRING_SENTINEL: &str = "CROWN-KEYRING-V1";

pub fn keyring_account_for_dir(crown_dir: &Path) -> String {
    let resolved = fs::canonicalize(crown_dir).unwrap_or_else(|_| crown_dir.to_path_buf());
    let digest = ring::digest::digest(
        &ring::digest::SHA256,
        resolved.to_string_lossy().as_bytes(),
    );
    format!("vault-master-key-{}", hex::encode(&digest.as_ref()[..8]))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn keyring_store_key(account: &str, raw_key: &[u8]) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
    let mut hex_key = hex::encode(raw_key);
    let res = entry.set_password(&hex_key).map_err(|e| e.to_string());
    hex_key.zeroize();
    res
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn keyring_load_key(account: &str) -> Result<Vec<u8>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
    let mut hex_key = entry.get_password().map_err(|e| e.to_string())?;
    let res = hex::decode(hex_key.trim()).map_err(|e| e.to_string());
    hex_key.zeroize();
    let key = res?;
    if key.len() == 32 {
        Ok(key)
    } else {
        Err("Invalid OS keyring master key length".to_string())
    }
}

#[cfg(target_os = "windows")]
fn dpapi_protect(raw_key: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut in_blob = CRYPT_INTEGER_BLOB {
        cbData: raw_key.len() as u32,
        pbData: raw_key.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &mut in_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
        .map_err(|e| format!("DPAPI protect failed: {}", e))?;
        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let protected = slice.to_vec();
        let _ = LocalFree(Some(HLOCAL(out_blob.pbData as *mut _)));
        Ok(protected)
    }
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(protected: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut in_blob = CRYPT_INTEGER_BLOB {
        cbData: protected.len() as u32,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &mut in_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
        .map_err(|e| format!("DPAPI unprotect failed: {}", e))?;
        let out_slice =
            std::slice::from_raw_parts_mut(out_blob.pbData, out_blob.cbData as usize);
        let key = out_slice.to_vec();
        out_slice.zeroize();
        let _ = LocalFree(Some(HLOCAL(out_blob.pbData as *mut _)));
        Ok(key)
    }
}

struct SingleNonce(Option<Nonce>);

fn atomic_write_restricted(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp_path = path.with_extension("tmp");
    if tmp_path.symlink_metadata().is_ok() {
        let _ = fs::remove_file(&tmp_path);
    }
    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(data).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

impl NonceSequence for SingleNonce {
    fn advance(&mut self) -> Result<Nonce, ring::error::Unspecified> {
        self.0.take().ok_or(ring::error::Unspecified)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VaultCredential {
    pub id: String,
    pub origin: String,
    pub username: String,
    pub secret: String,
    pub created_at: u64,
}

impl Zeroize for VaultCredential {
    fn zeroize(&mut self) {
        self.secret.zeroize();
        self.username.zeroize();
    }
}

#[derive(Serialize, Deserialize, Default)]
struct EncryptedVaultPackage {
    pub nonce_hex: String,
    pub ciphertext_hex: String,
    pub security_level: String,
    pub version: u32,
}

pub struct SystemVault {
    pub security_level: Mutex<String>, // "HARDWARE_ONLY" | "HARDWARE_WITH_BIOMETRIC"
    crown_dir: PathBuf,
    vault_file: PathBuf,
    key_file: PathBuf,
}

pub fn sanitize_vault_profile_id(raw: Option<&str>) -> Result<String, String> {
    let trimmed = raw.unwrap_or("default").trim();
    if trimmed.is_empty() || trimmed == "default" {
        return Ok("default".to_string());
    }
    if trimmed.len() > 64
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Invalid profile identifier".to_string());
    }
    Ok(trimmed.to_string())
}

impl SystemVault {
    pub fn new(base_dir: &Path) -> Self {
        let crown_dir = base_dir.join("Crown");
        let _ = fs::create_dir_all(&crown_dir);
        let vault_file = crown_dir.join("vault.enc");
        let key_file = crown_dir.join(".master_hardware_key");

        let mut initial_level = "HARDWARE_ONLY".to_string();
        if vault_file.exists() {
            if let Ok(mut f) = File::open(&vault_file) {
                let mut content = String::new();
                if f.read_to_string(&mut content).is_ok() {
                    if let Ok(pkg) = serde_json::from_str::<EncryptedVaultPackage>(&content) {
                        if !pkg.security_level.is_empty() {
                            initial_level = pkg.security_level;
                        }
                    }
                }
            }
        }

        Self {
            security_level: Mutex::new(initial_level),
            crown_dir,
            vault_file,
            key_file,
        }
    }

    fn vault_file_for_profile(&self, profile_id: Option<&str>) -> Result<PathBuf, String> {
        let safe_id = sanitize_vault_profile_id(profile_id)?;
        if safe_id == "default" {
            return Ok(self.vault_file.clone());
        }
        let dir = self.crown_dir.join("vaults").join(&safe_id);
        let _ = fs::create_dir_all(&dir);
        Ok(dir.join("vault.enc"))
    }

    // Hardware Master Key extraction
    // Binds key state to OS-protected storage (Windows DPAPI) with stack zeroization
    pub fn fetch_hardware_master_key(&self) -> Result<Vec<u8>, String> {
        if self.key_file.exists() {
            let mut file = File::open(&self.key_file).map_err(|e| e.to_string())?;
            let mut buf = String::new();
            file.read_to_string(&mut buf).map_err(|e| e.to_string())?;
            let trimmed = buf.trim();

            #[cfg(target_os = "windows")]
            if let Some(hex_cipher) = trimmed.strip_prefix(DPAPI_KEY_PREFIX) {
                let mut protected = hex::decode(hex_cipher).map_err(|e| e.to_string())?;
                buf.zeroize();
                let res = dpapi_unprotect(&protected);
                protected.zeroize();
                let key = res?;
                if key.len() == 32 {
                    return Ok(key);
                }
                return Err("Invalid DPAPI master key length".to_string());
            }

            #[cfg(any(target_os = "macos", target_os = "linux"))]
            if trimmed == KEYRING_SENTINEL {
                buf.zeroize();
                let account = keyring_account_for_dir(&self.crown_dir);
                return keyring_load_key(&account);
            }

            // Legacy un-wrapped 64-char hex key (or non-Windows 0o600 key)
            let decoded = hex::decode(trimmed);
            buf.zeroize();
            if let Ok(mut key) = decoded {
                if key.len() == 32 {
                    #[cfg(target_os = "windows")]
                    {
                        if let Ok(mut protected) = dpapi_protect(&key) {
                            let mut payload = format!("{}{}", DPAPI_KEY_PREFIX, hex::encode(&protected));
                            let _ = atomic_write_restricted(&self.key_file, payload.as_bytes());
                            payload.zeroize();
                            protected.zeroize();
                        }
                    }
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    {
                        let account = keyring_account_for_dir(&self.crown_dir);
                        if keyring_store_key(&account, &key).is_ok() {
                            let _ = atomic_write_restricted(&self.key_file, KEYRING_SENTINEL.as_bytes());
                        }
                    }
                    return Ok(key);
                }
                key.zeroize();
            }
        }

        // Initialize high-entropy hardware random key
        let rng = SystemRandom::new();
        let mut raw_key = vec![0u8; 32];
        rng.fill(&mut raw_key).map_err(|_| "Hardware RNG failure".to_string())?;

        #[cfg(target_os = "windows")]
        {
            let mut protected = dpapi_protect(&raw_key)?;
            let mut payload = format!("{}{}", DPAPI_KEY_PREFIX, hex::encode(&protected));
            let write_res = atomic_write_restricted(&self.key_file, payload.as_bytes());
            payload.zeroize();
            protected.zeroize();
            write_res?;
            return Ok(raw_key);
        }

        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let account = keyring_account_for_dir(&self.crown_dir);
            if keyring_store_key(&account, &raw_key).is_ok() {
                if atomic_write_restricted(&self.key_file, KEYRING_SENTINEL.as_bytes()).is_ok() {
                    return Ok(raw_key);
                }
            }
            let mut hex_encoded = hex::encode(&raw_key);
            let write_res = atomic_write_restricted(&self.key_file, hex_encoded.as_bytes());
            hex_encoded.zeroize();
            write_res?;
            return Ok(raw_key);
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            let mut hex_encoded = hex::encode(&raw_key);
            let write_res = atomic_write_restricted(&self.key_file, hex_encoded.as_bytes());
            hex_encoded.zeroize();
            write_res?;
            Ok(raw_key)
        }
    }

    pub fn set_security_level(&self, level: &str) {
        let clean = if level == "HARDWARE_WITH_BIOMETRIC" {
            "HARDWARE_WITH_BIOMETRIC"
        } else {
            "HARDWARE_ONLY"
        };
        if let Ok(mut l) = self.security_level.lock() {
            *l = clean.to_string();
        }
        // Persist level with existing credentials
        if let Ok(entries) = self.get_entries() {
            let _ = self.save_all_entries(&entries);
        }
    }

    pub fn get_security_level(&self) -> String {
        self.security_level
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    // AES-256-GCM Encrypted storage read (profile-isolated)
    pub fn get_entries(&self) -> Result<Vec<VaultCredential>, String> {
        self.get_entries_for_profile(None)
    }

    pub fn get_entries_for_profile(
        &self,
        profile_id: Option<&str>,
    ) -> Result<Vec<VaultCredential>, String> {
        let target_file = self.vault_file_for_profile(profile_id)?;
        if !target_file.exists() {
            return Ok(Vec::new());
        }

        let mut file = File::open(&target_file).map_err(|e| e.to_string())?;
        let mut pkg_str = String::new();
        file.read_to_string(&mut pkg_str).map_err(|e| e.to_string())?;

        let pkg: EncryptedVaultPackage =
            serde_json::from_str(&pkg_str).map_err(|e| e.to_string())?;

        let nonce_bytes = hex::decode(&pkg.nonce_hex).map_err(|e| e.to_string())?;
        if nonce_bytes.len() != NONCE_LEN {
            return Err("Invalid nonce length in vault".to_string());
        }
        let mut nonce_arr = [0u8; NONCE_LEN];
        nonce_arr.copy_from_slice(&nonce_bytes);

        let mut key_bytes = self.fetch_hardware_master_key()?;
        let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
            .map_err(|_| "AES-256-GCM key init failure".to_string())?;
        key_bytes.zeroize();

        let nonce = Nonce::assume_unique_for_key(nonce_arr);
        let mut opening_key = OpeningKey::new(unbound, SingleNonce(Some(nonce)));

        let mut in_out = hex::decode(&pkg.ciphertext_hex).map_err(|e| e.to_string())?;
        let aad = if pkg.version >= 2 {
            Aad::from(VAULT_AAD)
        } else {
            Aad::from(&[][..])
        };
        let decrypted = opening_key
            .open_in_place(aad, &mut in_out)
            .map_err(|_| "Vault authentication verification failed (tampered data)".to_string())?;

        let parse_res: Result<Vec<VaultCredential>, String> =
            serde_json::from_slice(decrypted).map_err(|e| e.to_string());

        // Zero out plaintext buffer even on parse failures
        in_out.zeroize();
        parse_res
    }

    pub fn save_entry(&self, entry: VaultCredential) -> Result<(), String> {
        self.save_entry_for_profile(None, entry)
    }

    pub fn save_entry_for_profile(
        &self,
        profile_id: Option<&str>,
        mut entry: VaultCredential,
    ) -> Result<(), String> {
        let target_file = self.vault_file_for_profile(profile_id)?;
        let mut entries = self
            .get_entries_for_profile(profile_id)
            .unwrap_or_default();
        let now_dur = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        if entry.id.is_empty() {
            entry.id = format!("cred-{}", now_dur.as_millis());
        }
        if entry.created_at == 0 {
            entry.created_at = now_dur.as_secs();
        }
        entries.retain(|e| e.id != entry.id);
        entries.push(entry);
        self.save_all_entries_to(&target_file, &entries)
    }

    pub fn delete_entry(&self, id: &str) -> Result<(), String> {
        self.delete_entry_for_profile(None, id)
    }

    pub fn delete_entry_for_profile(
        &self,
        profile_id: Option<&str>,
        id: &str,
    ) -> Result<(), String> {
        let target_file = self.vault_file_for_profile(profile_id)?;
        let mut entries = self
            .get_entries_for_profile(profile_id)
            .unwrap_or_default();
        entries.retain(|e| e.id != id);
        self.save_all_entries_to(&target_file, &entries)
    }

    pub fn delete_profile_vault(&self, profile_id: &str) -> Result<(), String> {
        let safe_id = sanitize_vault_profile_id(Some(profile_id))?;
        if safe_id == "default" {
            return Err("Cannot delete default profile vault".to_string());
        }
        let dir = self.crown_dir.join("vaults").join(&safe_id);
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn save_all_entries(&self, entries: &[VaultCredential]) -> Result<(), String> {
        self.save_all_entries_to(&self.vault_file, entries)
    }

    fn save_all_entries_to(
        &self,
        target_file: &Path,
        entries: &[VaultCredential],
    ) -> Result<(), String> {
        let mut plaintext = serde_json::to_vec(entries).map_err(|e| e.to_string())?;

        let rng = SystemRandom::new();
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rng.fill(&mut nonce_bytes)
            .map_err(|_| "Nonce generation failure".to_string())?;

        let mut key_bytes = self.fetch_hardware_master_key()?;
        let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
            .map_err(|_| "AES-256-GCM key init failure".to_string())?;
        key_bytes.zeroize();

        let nonce = Nonce::assume_unique_for_key(nonce_bytes);
        let mut sealing_key = SealingKey::new(unbound, SingleNonce(Some(nonce)));

        let mut in_out = plaintext.clone();
        sealing_key
            .seal_in_place_append_tag(Aad::from(VAULT_AAD), &mut in_out)
            .map_err(|_| "AES-256-GCM sealing failure".to_string())?;

        plaintext.zeroize();

        let pkg = EncryptedVaultPackage {
            nonce_hex: hex::encode(nonce_bytes),
            ciphertext_hex: hex::encode(in_out),
            security_level: self.get_security_level(),
            version: 2,
        };

        let json_data = serde_json::to_string_pretty(&pkg).map_err(|e| e.to_string())?;
        atomic_write_restricted(target_file, json_data.as_bytes())
    }
}

