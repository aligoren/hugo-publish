//! Which forge's API the deploy status comes from: remote URLs plus the per-site `forge`
//! setting. Nothing talks to the network.

use std::fs;

use hugo_publisher_lib::git::deploy::forge::{self, ForgeKind, SETTINGS_FILE};
use hugo_publisher_lib::git::deploy::github::DeployStatus;

#[test]
fn reads_the_forge_setting_of_a_site() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(forge::read_setting(dir.path()), None);

    let path = dir.path().join(SETTINGS_FILE);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        &path,
        "# deploy\n[deploy]\nmethod = \"push\"\nforge = \"gitlab\"\n",
    )
    .unwrap();
    let setting = forge::read_setting(dir.path());
    assert_eq!(setting, Some(ForgeKind::Gitlab));

    // A self-hosted server is only recognised with the setting.
    let url = "git@code.example.org:web/team/blog.git";
    assert_eq!(forge::detect(url, None), None);
    let repo = forge::detect(url, setting).unwrap();
    assert_eq!(repo.api, "https://code.example.org/api/v4");
    assert_eq!(repo.full_path(), "web/team/blog");

    let status = DeployStatus::new(&repo, "abc1234");
    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(json["forge"], "gitlab");
    assert_eq!(json["owner"], "web/team");
    assert_eq!(json["needsAuth"], false);
    assert_eq!(json["source"], "api");

    fs::write(&path, "[deploy]\nforge = \"bitbucket\"\n").unwrap();
    assert_eq!(forge::read_setting(dir.path()), None);
}
