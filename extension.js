// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const chokidar = require("chokidar");
const path = require('path');
const fs = require('fs');

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */

let tabs = [];

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

const storeBranchTabs = async (repoPath, branchName, store) => {
  if (!store.has(repoPath)) {
    store.set(repoPath, new Map());
  }

  store.get(repoPath).set(branchName, tabs);

  console.log(`
	***** SAVING *****
	Saved tabs for ${repoPath}:${branchName} 
	tabs = ${JSON.stringify(tabs)}
	`);
};

const closeTabs = async () => {
  vscode.commands.executeCommand('workbench.action.closeAllEditors');
};

const openBranchTabs = async (repoPath, branchName, store) => {
  const branchStore = store.get(repoPath);

  if (branchStore.has(branchName)) {
    const tabs = branchStore.get(branchName);
    console.log(`
		***** OPEN *****
		Opening saved tabs for ${repoPath}:${branchName}
		tabs = ${JSON.stringify(tabs)}
		`);
    for (const tab of tabs) {
      await vscode.commands.executeCommand(
        "vscode.open",
        vscode.Uri.file(tab.path),
        { preview: false, viewColumn: tab.viewColumn }
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
};

const saveAndCloseCurrentEditorState = async (currentRepository, store) => {
	const branchName = currentRepository.state.HEAD.name;
	const repoPath = currentRepository.rootUri.path;

	// save current branch's tabs in store
	await storeBranchTabs(repoPath, branchName, store);

	// close all current tabs
	await closeTabs();
};

const trackVSCodeUIBranchUpdates = (gitExtension, editor, store) => {
  const activeEditorFilePath = editor.document.uri;
  const currentRepository = gitExtension.getRepository(activeEditorFilePath);
  const repoPath = currentRepository.rootUri.path;

  if (!store.has(repoPath)) {
    currentRepository.repository.onDidChangeOperations(async (e) => {
      if (e === "Checkout") {
        await saveAndCloseCurrentEditorState(currentRepository, store);
      }
      if (e.operation?.kind === "Checkout") {
        const newBranchName = e.operation?.refLabel;
        // restore new branch's tabs
        await openBranchTabs(repoPath, newBranchName, store);
      }
    });
  }
};

const trackTerminalBranchUpdates = (gitExtension, editor, store) => {
  const activeEditorFilePath = editor.document.uri;
  const currentRepository = gitExtension.getRepository(activeEditorFilePath);
  const repoPath = currentRepository.rootUri.path;

  if (!store.has(repoPath)) {
	const GIT_HEAD_FILE_PATH = path.join(repoPath, '.git', 'HEAD');
	const watcher = chokidar.watch(GIT_HEAD_FILE_PATH);
	watcher.on('change', () => {
		fs.readFile(GIT_HEAD_FILE_PATH, 'utf-8', async (err, data) => {
			if(!err) {
				await saveAndCloseCurrentEditorState(currentRepository, store);

				const newBranchName = data.split('/').pop().trim();

				// restore new branch's tabs
				await openBranchTabs(repoPath, newBranchName, store);
			}
		})
	});
  }
};

const trackGitExtensionUpdates = (gitExtension, context, store) => {
  if (gitExtension.state === "initialized") {
    trackActiveTextEditor(gitExtension, context, store);
  } else {
    gitExtension.onDidChangeState((e) => {
      if (e === "initialized") {
        trackActiveTextEditor(gitExtension, context, store);
      }
    });
  }
};

const trackBranchUpdates = (gitExtension, editor, store) => {
	if(editor) {
		trackVSCodeUIBranchUpdates(gitExtension, editor, store);
		trackTerminalBranchUpdates(gitExtension, editor, store);
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

const trackActiveTextEditor = (gitExtension, context, store) => {
  if (vscode.window.activeTextEditor) {
    const editor = vscode.window.activeTextEditor;

    updateOpenTabs(gitExtension, editor);
    trackBranchUpdates(gitExtension, editor, store);
  }

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      updateOpenTabs(gitExtension, editor);
		  trackBranchUpdates(gitExtension, editor, store);
    },
    null,
    context.subscriptions
  );
};

const getConfig = () => {
  return vscode.workspace.getConfiguration("branchy");
};

const activate = async (context) => {
  const store = new Map();
  const gitExtension = await getGitExtension();

  if (gitExtension) {
    trackGitExtensionUpdates(gitExtension, context, store);
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
