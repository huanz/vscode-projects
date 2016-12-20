// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const homeDir = os.homedir();
const homePathVariable = '$home';

interface ProjectElement {
    label: string,
    description: string
}


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    let projectsStored: string = context.globalState.get<string>('recent', '');
    let aStack: StringStack = new StringStack();
    aStack.fromString(projectsStored);
    
    let statusItem: vscode.StatusBarItem;
    showStatusBar();

    // register commands
    vscode.commands.registerCommand('projectManager.saveProject', () => saveProject());
    vscode.commands.registerCommand('projectManager.editProjects', () => editProjects());
    vscode.commands.registerCommand('projectManager.listProjects', () => listProjects(false, [ProjectsSource.Projects, ProjectsSource.VSCode]));
    vscode.commands.registerCommand('projectManager.listProjectsNewWindow', () => listProjects(true, [ProjectsSource.Projects, ProjectsSource.VSCode]));

    // function commands
    function showStatusBar(projectName?: string) {
          let showStatusConfig = vscode.workspace.getConfiguration('projectManager').get('showProjectNameInStatusBar');
          let currentProjectPath = vscode.workspace.rootPath;

          if (!showStatusConfig || !currentProjectPath) {return ;}


	        if (!statusItem) {
                statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
            }
            statusItem.text = '$(file-directory) ';
            statusItem.tooltip = currentProjectPath;
            if (vscode.workspace.getConfiguration('projectManager').get('openInNewWindow', true)) {
                statusItem.command = 'projectManager.listProjectsNewWindow'
            } else {
                statusItem.command = 'projectManager.listProjects'
            }
	        // if we have a projectName, we don't need to search.
	        if (projectName) {
	            statusItem.text += projectName;
	            statusItem.show();
	            return;
	        }

            let items:Array<ProjectElement> = loadProjects();

            currentProjectPath = currentProjectPath.toString().toLowerCase();

	        let currentProject:ProjectElement = items.find((element) => expandHomePath(element.description.toString()).toLowerCase() === currentProjectPath);

	        if (currentProject) {
	            statusItem.text += currentProject.label;
	            statusItem.show();
	        }
	};


    function sortProjectList(items): any[] {
        let itemsToShow = expandHomePaths(items);
        itemsToShow = removeRootPath(itemsToShow);
        itemsToShow = indicateInvalidPaths(itemsToShow);
        let sortList = vscode.workspace.getConfiguration('projectManager').get('sortList', 'Name');
        let newItemsSorted = ProjectsSorter.SortItemsByCriteria(itemsToShow, sortList, aStack);
        return newItemsSorted;
    }

    function listProjects(forceNewWindow: boolean, sources: ProjectsSourceSet) {
        let items = [];

        if (fs.statSync(getProjectPath()).isDirectory()) {
            items = loadProjects();
            if (!items) {
                return;
            }
        } else {
            vscode.window.showInformationMessage('No projects saved yet!');
            return;
        }

        function onRejectListProjects(reason) {
            vscode.window.showInformationMessage('Error loading projects: ${reason}');
        }


        // promisses
        function onResolve(selected) {
            if (!selected) {
                return;
            }

           // vscode.window.showInformationMessage(selected.label);

            if (!fs.existsSync(selected.description.toString())) {
                var optionUpdateProject = <vscode.MessageItem>{
                    title: "Update Project"
                };
                var optionDeleteProject = <vscode.MessageItem>{
                    title: "Delete Project"
                };

                vscode.window.showErrorMessage('The project has an invalid path. What would you like to do?', optionUpdateProject, optionDeleteProject).then(option => {
                    // nothing selected
                    if (typeof option == 'undefined') {
                        return;
                    }

                    if (option.title == "Update Project") {
                        vscode.commands.executeCommand('projectManager.editProjects');
                    } else { // Update Project
                        let itemsFiltered = [];
                        itemsFiltered = items.filter(value => value.description.toString().toLowerCase() != selected.description.toLowerCase());
                        fs.writeFileSync(getProjectFilePath(), JSON.stringify(itemsFiltered, null, "\t"));
                        return;
                    }
                });
            } else {
                // project path
                let projectPath = selected.description;
                projectPath = normalizePath(projectPath);

                // update MRU
                aStack.push(selected.label);
                context.globalState.update('recent', aStack.toString());

                let openInNewWindow: boolean = vscode.workspace.getConfiguration('projectManager').get('openInNewWindow', true);
                let uri: vscode.Uri = vscode.Uri.file(projectPath);
                vscode.commands.executeCommand('vscode.openFolder', uri, openInNewWindow || forceNewWindow)
                    .then(
                        value => ( {} ),  //done
                        value => vscode.window.showInformationMessage('Could not open the project!') );
            }
        }


        let options = <vscode.QuickPickOptions>{
            placeHolder: 'Loading Projects (pick one to open)',
            matchOnDescription: false,
            matchOnDetail: false
        };


        let getProjectsPromise = getProjects(items, sources)
            .then((folders) => {

                // not in SET
                if (sources.indexOf(ProjectsSource.VSCode) == -1) {
                    return folders;
                }

                // has PROJECTS and is NOT MERGED - always merge
                // if ((sources.indexOf(ProjectsSource.Projects) > -1)  && (!<boolean>vscode.workspace.getConfiguration('projectManager').get('vscode.mergeProjects', true))) {
                //     return folders;
                // }

                // Ok, can have VSCode
                let merge: boolean = MERGE_PROJECTS;// vscode.workspace.getConfiguration('projectManager').get('vscode.mergeProjects', true);
                return getVSCodeProjects(<any[]>folders, merge);
            })
            .then((folders) => { // sort
                return sortProjectList(folders);
            });

        vscode.window.showQuickPick(getProjectsPromise, options)
            .then(onResolve, onRejectListProjects);
    };

    function removeRootPath(items:any[]): any[] {
        if (!vscode.workspace.rootPath) {
            return items;
        } else {
            return items.filter(value => value.description.toString().toLowerCase() != vscode.workspace.rootPath.toLowerCase());
        }
    }

    function indicateInvalidPaths(items:any[]): any[] {
        for (var index = 0; index < items.length; index++) {
            var element = items[index];

            if (!fs.existsSync(element.description.toString()) ) {
                items[index].detail = '$(circle-slash) Path does not exist';
            }
        }

        return items;
    }

    function pathIsUNC(path:string) {
      return path.indexOf('\\\\') == 0;
    }

    /**
     * If the project path is in the user's home directory then store the home directory as a
     * parameter. This will help in situations when the user works with the same projects on
     * different machines, under different user names.
     */
    function compactHomePath(path: string) {
        if (path.indexOf(homeDir) === 0) {
            return path.replace(homeDir, homePathVariable);
        }

        return path;
    }

    /**
     * Expand $home parameter from path to real os home path
     */
    function expandHomePath(path: string) {
        if (path.indexOf(homePathVariable) === 0) {
            return path.replace(homePathVariable, homeDir);
        }

        return path;
    }

    function expandHomePaths(items: any[]) {
        return items.map(item => {
            item.description = expandHomePath(item.description);
            return item;
        });
    }

    function normalizePath(path: string): string {
        let normalizedPath: string = path;

        if (!pathIsUNC(normalizedPath)) {
          let replaceable = normalizedPath.split('\\');
          normalizedPath = replaceable.join('\\\\');
        }

        return normalizedPath;
    }

    function loadProjects(): any[] {
        var items = [];
        var projectDir = getProjectPath();

        if (projectDir) {
            let file = getProjectFilePath();
            if (file) {
                try {
                    return JSON.parse(fs.readFileSync(file).toString());
                } catch (error) {
                    let optionOpenFile = <vscode.MessageItem>{
                        title: "Open File"
                    };
                    showError('Error loading projects.json file. Message: ' + error.toString(), optionOpenFile).then(option => {
                        if (typeof option == 'undefined') {
                            return;
                        }

                        if (option.title == "Open File") {
                            vscode.commands.executeCommand('projectManager.editProjects');
                        } else {
                            return;
                        }
                    });
                }
            } else {
                let ignoredFolders = vscode.workspace.getConfiguration('projectManager').get('vscode.ignoredFolders', []);
                return fs.readdirSync(projectDir).filter(function (dir) {
                    return !dir.startsWith('.') && ignoredFolders.indexOf(dir) === -1 && fs.statSync(path.join(projectDir, dir)).isDirectory();
                }).map(function (dir) {
                    return {
                        label: dir,
                        description: path.join(projectDir, dir)
                    };
                });
            }
        } else {
            showError('Error loading project dir');
        }
    }

    function getChannelPath(): string {
        if (vscode.env.appName.indexOf('Insiders') > 0) {
            return 'Code - Insiders';
        } else {
            return 'Code';
        }
    }

    function getProjectPath() {
        let projectsLocation: string = vscode.workspace.getConfiguration('projectManager').get<string>('projectsLocation');
        projectsLocation = projectsLocation ? expandHomePath(projectsLocation) : path.join(homeDir, 'projects');
        try {
            let stats = fs.statSync(projectsLocation);
            if (stats.isDirectory()) {
                return projectsLocation;
            } else {
                showError('projectsLocation must be a folder');
            }
        } catch (error) {
            showError('projectManager.projectsLocation not exist');
        }
    }

    function getProjectFilePath() {
        let file = path.join(getProjectPath(), PROJECTS_FILE);
        try {
            let stats = fs.statSync(file);
            if (stats.isFile()) {
                return file;
            }
        } catch (error) {
            return;
        }
    }

    function showError(msg: string, option?: vscode.MessageItem): Thenable<any> {
        return vscode.window.showErrorMessage(msg, option);
    }
}
