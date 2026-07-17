use std::{fs::File, io::Read, path::Path};

use base64::Engine as _;

use super::protocol::{
    upload_file_invalid, UploadFilePayload, PAGE_AUTOMATION_MAX_UPLOAD_FILES,
    PAGE_AUTOMATION_MAX_UPLOAD_FILE_BYTES, PAGE_AUTOMATION_MAX_UPLOAD_TOTAL_BYTES,
};
use crate::mcp::types::ToolError;

struct ValidatedUpload {
    file: File,
    name: String,
    mime_type: String,
    size: u64,
}

pub fn read_upload_files(paths: &[String]) -> Result<Vec<UploadFilePayload>, ToolError> {
    if paths.is_empty() || paths.len() > PAGE_AUTOMATION_MAX_UPLOAD_FILES {
        return Err(upload_file_invalid());
    }

    let mut total_size = 0_u64;
    let mut validated = Vec::with_capacity(paths.len());
    for requested in paths {
        let requested = Path::new(requested);
        if !requested.is_absolute() {
            return Err(upload_file_invalid());
        }
        let canonical = requested
            .canonicalize()
            .map_err(|_| upload_file_invalid())?;
        let file = File::open(&canonical).map_err(|_| upload_file_invalid())?;
        let metadata = file.metadata().map_err(|_| upload_file_invalid())?;
        if !metadata.is_file() || metadata.len() > PAGE_AUTOMATION_MAX_UPLOAD_FILE_BYTES {
            return Err(upload_file_invalid());
        }
        total_size = total_size
            .checked_add(metadata.len())
            .ok_or_else(upload_file_invalid)?;
        if total_size > PAGE_AUTOMATION_MAX_UPLOAD_TOTAL_BYTES {
            return Err(upload_file_invalid());
        }
        let name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or_else(upload_file_invalid)?
            .to_string();
        validated.push(ValidatedUpload {
            file,
            mime_type: mime_type(&canonical).to_string(),
            name,
            size: metadata.len(),
        });
    }

    validated
        .into_iter()
        .map(|mut upload| {
            let capacity = usize::try_from(upload.size).map_err(|_| upload_file_invalid())?;
            let mut bytes = Vec::with_capacity(capacity);
            upload
                .file
                .read_to_end(&mut bytes)
                .map_err(|_| upload_file_invalid())?;
            if bytes.len() as u64 != upload.size {
                return Err(upload_file_invalid());
            }
            Ok(UploadFilePayload {
                name: upload.name,
                mime_type: upload.mime_type,
                size: upload.size,
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        })
        .collect()
}

fn mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("txt") => "text/plain",
        Some("json") => "application/json",
        Some("csv") => "text/csv",
        Some("html" | "htm") => "text/html",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::read_upload_files;
    use crate::mcp::page_automation::protocol::{
        PAGE_AUTOMATION_MAX_UPLOAD_FILES, PAGE_AUTOMATION_MAX_UPLOAD_FILE_BYTES,
        PAGE_AUTOMATION_MAX_UPLOAD_TOTAL_BYTES,
    };

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("sheltie-upload-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn strings(paths: &[PathBuf]) -> Vec<String> {
        paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn reads_an_absolute_regular_file_with_basename_and_size() {
        let directory = TestDirectory::new();
        let path = directory.file("hello.txt", b"hello");

        let files = read_upload_files(&strings(std::slice::from_ref(&path))).unwrap();

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "hello.txt");
        assert_eq!(files[0].size, 5);
        assert_eq!(files[0].mime_type, "text/plain");
        assert_eq!(files[0].bytes_base64, "aGVsbG8=");
        assert!(!serde_json::to_string(&files)
            .unwrap()
            .contains(path.to_string_lossy().as_ref()));
    }

    #[test]
    fn rejects_relative_directory_missing_and_unreadable_paths() {
        let directory = TestDirectory::new();
        let missing = directory.0.join("missing.txt");
        for paths in [
            vec!["relative.txt".to_string()],
            strings(std::slice::from_ref(&directory.0)),
            strings(&[missing]),
        ] {
            assert_eq!(
                read_upload_files(&paths).unwrap_err().code,
                "upload_file_invalid"
            );
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let unreadable = directory.file("unreadable.txt", b"secret");
            fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();
            assert_eq!(
                read_upload_files(&strings(std::slice::from_ref(&unreadable)))
                    .unwrap_err()
                    .code,
                "upload_file_invalid"
            );
            fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o600)).unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn canonicalizes_a_symlink_to_a_regular_file() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new();
        let target = directory.file("target.json", br#"{"ok":true}"#);
        let link = directory.0.join("alias.json");
        symlink(&target, &link).unwrap();

        let files = read_upload_files(&strings(&[link])).unwrap();

        assert_eq!(files[0].name, "target.json");
        assert_eq!(files[0].mime_type, "application/json");
    }

    #[test]
    fn rejects_count_per_file_and_total_limits_before_reading_bytes() {
        let directory = TestDirectory::new();
        let too_many = (0..=PAGE_AUTOMATION_MAX_UPLOAD_FILES)
            .map(|index| directory.file(&format!("{index}.txt"), b""))
            .collect::<Vec<_>>();
        assert_eq!(
            read_upload_files(&strings(&too_many)).unwrap_err().code,
            "upload_file_invalid"
        );

        let oversized = directory.file("oversized.bin", b"");
        fs::OpenOptions::new()
            .write(true)
            .open(&oversized)
            .unwrap()
            .set_len(PAGE_AUTOMATION_MAX_UPLOAD_FILE_BYTES + 1)
            .unwrap();
        assert_eq!(
            read_upload_files(&strings(&[oversized])).unwrap_err().code,
            "upload_file_invalid"
        );

        let file_size = PAGE_AUTOMATION_MAX_UPLOAD_TOTAL_BYTES / 5 + 1;
        let total = (0..5)
            .map(|index| {
                let path = directory.file(&format!("total-{index}.bin"), b"");
                fs::OpenOptions::new()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_len(file_size)
                    .unwrap();
                path
            })
            .collect::<Vec<_>>();
        assert_eq!(
            read_upload_files(&strings(&total)).unwrap_err().code,
            "upload_file_invalid"
        );
    }

    #[test]
    fn errors_never_expose_requested_or_canonical_paths() {
        let directory = TestDirectory::new();
        let missing = directory.0.join("private-name.txt");
        let requested = missing.to_string_lossy().into_owned();

        let error = read_upload_files(std::slice::from_ref(&requested)).unwrap_err();
        let json = serde_json::to_string(&error).unwrap();

        assert!(!json.contains(&requested));
        assert!(!json.contains(directory.0.to_string_lossy().as_ref()));
    }
}
