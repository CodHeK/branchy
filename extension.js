// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const chokidar = require("chokidar");
const path = require('path');
const fs = require('fs');
const _ = require('lodash');

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */

let tabs = [];
const store = new Map();
const prevBranchNameMap = new Map();

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

const storeBranchTabs = (repoPath, branchName) => {  
  if (!store.has(repoPath)) {
    store.set(repoPath, new Map());
  }

  store.get(repoPath).set(branchName, _.cloneDeep(tabs));

  console.log(`
	***** SAVING *****
	Saved tabs for ${repoPath}:${branchName} 
	tabs = ${JSON.stringify(tabs)}
	`);
};

const closeTabs = async () => {
  vscode.commands.executeCommand('workbench.action.closeAllEditors');
};

const openBranchTabs = async (repoPath, branchName) => {
  const branchStore = store.get(repoPath);

  if (branchStore.has(branchName)) {
    const tabsToOpen = branchStore.get(branchName);
    console.log(`
		***** OPEN *****
		Opening saved tabs for ${repoPath}:${branchName}
		tabs = ${JSON.stringify(tabsToOpen)}
		`);
    for (const tab of tabsToOpen) {
      await vscode.commands.executeCommand(
        "vscode.open",
        vscode.Uri.file(tab.path),
        { preview: false, viewColumn: tab.viewColumn }
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
};

const saveAndCloseCurrentEditorState = (currentRepository, metadata) => {
	const branchName = metadata?.prevBranchName ?? currentRepository.state.HEAD.name;
	const repoPath = currentRepository.rootUri.path;

	// save current branch's tabs in store
	storeBranchTabs(repoPath, branchName);

	// close all current tabs
	closeTabs();
};

const trackVSCodeUIBranchUpdates = (gitExtension, editor) => {
  const activeEditorFilePath = editor.document.uri;
  const currentRepository = gitExtension.getRepository(activeEditorFilePath);
  const repoPath = currentRepository.rootUri.path;

  if (!store.has(repoPath)) {
    currentRepository.repository.onDidChangeOperations(async (e) => {
      if (e === "Checkout") {
        saveAndCloseCurrentEditorState(currentRepository);
      }
      if (e.operation?.kind === "Checkout") {
        const newBranchName = e.operation?.refLabel;
        // restore new branch's tabs
        await openBranchTabs(repoPath, newBranchName);
      }
    });
  }
};

const trackTerminalBranchUpdates = (gitExtension, editor) => {
  const activeEditorFilePath = editor.document.uri;
  const currentRepository = gitExtension.getRepository(activeEditorFilePath);
  const repoPath = currentRepository.rootUri.path;

  if (!store.has(repoPath)) {
	const GIT_HEAD_FILE_PATH = path.join(repoPath, '.git', 'HEAD');
	const watcher = chokidar.watch(GIT_HEAD_FILE_PATH);

  prevBranchNameMap.set(repoPath, currentRepository.state.HEAD.name);

	watcher.on('change', () => {
		fs.readFile(GIT_HEAD_FILE_PATH, 'utf-8', async (err, data) => {
			if(!err) {
        const prevBranchName = prevBranchNameMap.get(repoPath);
        const newBranchName = data.split('/').pop().trim();

        if(prevBranchName !== newBranchName) {
          saveAndCloseCurrentEditorState(currentRepository, { prevBranchName, });
          prevBranchNameMap.set(repoPath, newBranchName);

          // restore new branch's tabs
          await openBranchTabs(repoPath, newBranchName);
        }
			}
		})
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
	if(editor) {
		trackVSCodeUIBranchUpdates(gitExtension, editor);
		trackTerminalBranchUpdates(gitExtension, editor);
	}
}

const updateOpenTabs = (gitExtension, editor) => {
  const activeEditorFilePath = editor.document.uri;
  const currentRepository = gitExtension.getRepository(activeEditorFilePath);
  const repoPath = currentRepository.rootUri.path;

  tabs = vscode.window.tabGroups.all.flatMap(({ tabs }) => {
    const isMultipleRepositoriesEnabled = getConfig().get(
      "multipleRepositoriesEnabled",
      true
    );
    return tabs
      .map((tab) => ({
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
}

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
