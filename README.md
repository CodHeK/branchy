<p align="center">
    <img src="assets/readme-new-logo.png" width=200>
</p>

A VSCode extension that helps you keep track of your working files based on the feature branch you're currently in. Get it [here](https://marketplace.visualstudio.com/items?itemName=gaganganapathyas.branchy).

### What made me build this?

In my daily work, I keep switching branches while working back and forth between features/issues, so I keep closing/opening tabs and it becomes a bit tedious. Usually when I open up a branch, I have no idea which files was I working with because my current vscode window is cluttered with all the files from across tons of branches.

![workflow](assets/workflow.png)

### How does branchy solve this problem?

*branchy* helps you build that isolation level on top of your current workspace that allows you to
peacefully navigate through the exploration phase and the implementation phase when working 
across different features at the same time.

### How to use?

It requires zero setup and works out of the box. It supports all modes of branch checkouts. 
You could either use the `VSCode UI` to switch branches or just type `git checkout <branch_name>` on your terminal 
and it takes care of everything.

### Extension settings

`branchy.isMultipleRepositoriesEnabled`: 

- Save files across mutiple repositories for certain a git branch.
- Is set to `true` by default.
- If set to `false` will only save editors that belong to the repository who's branch is open.