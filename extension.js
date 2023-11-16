// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const chokidar = require("chokidar");
const path = require("path");
const fs = require("fs");
const _ = require("lodash");
const memoizeOne = require('memoize-one');
const memoizeOneAsync = require('async-memoize-one');

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */

let tabs = [];
const store = new Map();
const prevBranchNameMap = new Map();
const repoBranches = new Map();
const DEBUG = true;

const log = (msg) => {
  if(DEBUG) {
    console.log(msg);
  }
}

const getGitExtension = async () => {
  try {
    const extension = vscode.extensions.getExtension("vscode.git");
    if (extension !== undefined) {
      const gitExtension = extension.isActive
        ? extension.exports
        : await extension.activate();

      return gitExtension.getAPI(1);
    }
  } catch (e) {}

  return undefined;
};

const storeBranchTabs = memoizeOne((repoPath, branchName) => {
  if (!store.has(repoPath)) {
    store.set(repoPath, new Map());
  }

  store.get(repoPath).set(branchName, _.cloneDeep(tabs));

  log(`
	***** SAVING *****
	Saved tabs for ${repoPath}:${branchName} 
	tabs = ${JSON.stringify(tabs)}
	`);
});

const closeTabs = () => {
  log(`***** CLOSING TABS *****`);
  return new Promise(async (resolve) => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    setTimeout(() => resolve(), 500);
  });
};

const openBranchTabsNonMemoized = async (repoPath, branchName) => {
  const branchStore = store.get(repoPath);

  if (branchStore.has(branchName)) {
    const tabsToOpen = branchStore.get(branchName);
    log(`
		***** OPEN *****
		Opening saved tabs for ${repoPath}:${branchName}
		tabs = ${JSON.stringify(tabsToOpen)}
		`);

    await openTabs(tabsToOpen.map((tab) => tab.path));
  }
};

const openTabsNonMemoized  = async (filePaths) => {
  try {
    const filesToShowPromises = filePaths.map((filePath) =>
      vscode.window.showTextDocument(vscode.Uri.file(filePath), {
        preview: false,
        viewColumn: 1,
      })
    );
    await Promise.all(filesToShowPromises);
  } catch (error) {
    log(`Error occurred while opening files: ${JSON.stringify(error)}`);
  }
};

const openBranchTabs = memoizeOneAsync(openBranchTabsNonMemoized);
const openTabs = memoizeOneAsync(openTabsNonMemoized);

const saveAndCloseCurrentEditorState = async (
  currentRepository,
  metadata,
  shouldCloseOpenTabs = true
) => {
  const branchName =
    metadata?.prevBranchName ?? currentRepository.state.HEAD.name;
  const repoPath = currentRepository.rootUri.path;

  // save current branch's tabs in store
  storeBranchTabs(repoPath, branchName);

  if (shouldCloseOpenTabs) {
    // close all current tabs
    await closeTabs();
  }
};

const trackVSCodeUIBranchUpdates = (gitExtension, editor) => {
  if (!editor) {
    return;
  }

  const activeEditorFilePath = editor.document.uri;
  const currentRepository = gitExtension.getRepository(activeEditorFilePath);
  const repoPath = currentRepository?.rootUri?.path ?? "";

  if (currentRepository && !store.has(repoPath)) {
    currentRepository.repository.onDidChangeOperations(async (e) => {
      if (e === "Checkout") {
        await saveAndCloseCurrentEditorState(currentRepository);
      }
      if (e.operation?.kind === "Checkout") {
        const newBranchName = e.operation?.refLabel;

        // restore new branch's tabs
        await openBranchTabs(repoPath, newBranchName);
      }
    });
  }
};

const storeExistingBranches = (repoPath) => {
  repoBranches[repoPath] = new Set();

  const headDir = path.join(repoPath, ".git", "refs", "heads");

  return new Promise((resolve) => {
    fs.readdir(headDir, (err, files) => {
      if (!err) {
        files.forEach((file) => {
          repoBranches[repoPath].add(file);
        });
        resolve();
      }
    });
  });
};

const trackTerminalBranchUpdates = async (gitExtension, editor) => {
  if (!editor) {
    return;
  }

  const activeEditorFilePath = editor.document.uri;
  const currentRepository = gitExtension.getRepository(activeEditorFilePath);
  const repoPath = currentRepository?.rootUri?.path ?? "";

  if (currentRepository && !store.has(repoPath)) {
    await storeExistingBranches(repoPath);

    const GIT_HEAD_FILE_PATH = path.join(repoPath, ".git", "HEAD");
    const gitHeadWatcher = chokidar.watch(GIT_HEAD_FILE_PATH);

    prevBranchNameMap.set(repoPath, currentRepository.state.HEAD.name);

    gitHeadWatcher.on("change", () => {
      fs.readFile(GIT_HEAD_FILE_PATH, "utf-8", async (err, data) => {
        if (!err) {
          const prevBranchName = prevBranchNameMap.get(repoPath);
          const newBranchName = data.split("/").pop().trim();

          if (prevBranchName !== newBranchName) {
            if (repoBranches[repoPath].has(newBranchName)) {
              await saveAndCloseCurrentEditorState(currentRepository, {
                prevBranchName,
              });

              // restore new branch's tabs
              await openBranchTabs(repoPath, newBranchName);
            } else {
              // Keep open editors as it is when checking out a new branch
              repoBranches[repoPath].add(newBranchName);
              await saveAndCloseCurrentEditorState(
                currentRepository,
                { prevBranchName },
                false
              );
            }

            prevBranchNameMap.set(repoPath, newBranchName);
          }
        }
      });
    });

    const REF_HEADS_DIR = path.join(repoPath, ".git", "refs", "heads");
    const refHeadsWatcher = chokidar.watch(REF_HEADS_DIR);

    refHeadsWatcher.on("unlink", async () => {
      log("branch deleted");
      await storeExistingBranches(repoPath);
    });
  }
};

const trackGitExtensionUpdates = (gitExtension, context) => {
  if (gitExtension.state === "initialized") {
    trackActiveTextEditor(gitExtension, context);
  } else {
    gitExtension.onDidChangeState((e) => {
      if (e === "initialized") {
        trackActiveTextEditor(gitExtension, context);
      }
    });
  }
};

const trackBranchUpdates = (gitExtension, editor) => {
  if (editor) {
    trackVSCodeUIBranchUpdates(gitExtension, editor);
    trackTerminalBranchUpdates(gitExtension, editor);
  }
};

const updateOpenTabs = (gitExtension, editor) => {
  if (!editor) {
    tabs = [];
    return;
  }

  const activeEditorFilePath = editor.document.uri;
  const currentRepository = gitExtension.getRepository(activeEditorFilePath);
  const repoPath = currentRepository?.rootUri?.path ?? "";

  tabs = vscode.window.tabGroups.all.flatMap(({ tabs: openTabs }) => {
    const isMultipleRepositoriesEnabled = getConfig().get(
      "multipleRepositoriesEnabled",
      true
    );
    return openTabs
      ?.map((tab) => ({
        path: tab.input.uri.path,
        viewColumn: tab.group.viewColumn,
      }))
      .filter((tab) => {
        if (!isMultipleRepositoriesEnabled) {
          const repoName = repoPath.split("/").pop();
          return tab.path.split("/").includes(repoName);
        }

        // allow tabs to be stored across multiple repositories.
        return true;
      });
  });
};

const trackActiveTextEditor = (gitExtension, context) => {
  if (vscode.window.activeTextEditor) {
    const editor = vscode.window.activeTextEditor;

    updateOpenTabs(gitExtension, editor);
    trackBranchUpdates(gitExtension, editor);
  }

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      updateOpenTabs(gitExtension, editor);
      trackBranchUpdates(gitExtension, editor);
    },
    null,
    context.subscriptions
  );
};

const getConfig = () => {
  return vscode.workspace.getConfiguration("branchy");
};

const activate = async (context) => {
  const gitExtension = await getGitExtension();

  if (gitExtension) {
    trackGitExtensionUpdates(gitExtension, context);
  } else {
    vscode.window.showErrorMessage(
      "Make sure you enable the Git extension for branchy to work."
    );
  }
};

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
