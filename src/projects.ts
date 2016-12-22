'use strict';
import {
    ExtensionContext,
    window,
    workspace,
    WorkspaceConfiguration,
    commands,
    StatusBarAlignment,
    StatusBarItem,
    QuickPickOptions,
    QuickPickItem,
    Uri,
    MessageItem,
    InputBoxOptions
} from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Store from './store';

interface ProjectElement {
    label: string,
    description: string
}

export default class Projects {
    homePathVariable: string = '$home'
    homeDir: string = os.homedir()

    context: ExtensionContext
    config: WorkspaceConfiguration

    private _statusBarItem: StatusBarItem
    private _store: Store

    constructor(context: ExtensionContext) {
        this.context = context;
        this.config = workspace.getConfiguration('projects');

        this._store = new Store(context);

        this.registerCommands();
        this.showStatusBar();

        context.subscriptions.push(this);
    }
    showStatusBar(): void {
        let showStatusBar = this.config.get('showProjectNameInStatusBar', true);
        let currentProjectPath = workspace.rootPath;
        if (showStatusBar && currentProjectPath) {
            if (!this._statusBarItem) {
                this._statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
            }
            this._statusBarItem.text = '$(file-directory) ';
            this._statusBarItem.tooltip = currentProjectPath;
            this._statusBarItem.command = 'projects.list';

            let projects: ProjectElement[] = this.getProjects();
            currentProjectPath = currentProjectPath.toString().toLowerCase();
            let currentProject: ProjectElement = projects.find((project) => project.description.toString().toLowerCase() === currentProjectPath);
            if (currentProject) {
                this._statusBarItem.text += currentProject.label;
                this._statusBarItem.show();
            }
        }
    }
    registerCommands(): void {
        this.context.subscriptions.push(commands.registerCommand('projects.list', () => this.listProjects()));
        this.context.subscriptions.push(commands.registerCommand('projects.reload', () => this.reloadProjects()));
        this.context.subscriptions.push(commands.registerCommand('projects.create', () => this.createProject()));
    }
    listProjects() {
        let projects: Promise<QuickPickItem[]> = new Promise((resolve, reject) => {
            resolve(this.getProjects());
        });
        let options = <QuickPickOptions>{
            placeHolder: 'load projects (pick one to open)',
            matchOnDescription: false,
            matchOnDetail: false
        };

        window.showQuickPick(projects, options).then(
            selected => this._pickProject(selected),
            () => this.showInfo('Error loading projects: ${reason}')
        );
    }
    reloadProjects() {
        this._store.clear('projects').then(() => this.listProjects());
    }
    createProject() {
        let options = <InputBoxOptions>{
            prompt: 'enter project name here',
            placeHolder: 'enter project name here',
            validateInput: (input) => {
                if (!input.trim()) {
                    return 'project name is required';
                }
                let projects = this.getProjects();
                if (projects && projects.some(project => project.label === input)) {
                    return 'this project is already exist';
                }
            }
        };
        window.showInputBox(options).then(input => {
            input = input.trim();
            if (input) {
                let projectDir = this.getProjectPath();
                if (projectDir) {
                    let newDir = path.join(projectDir, input);
                    fs.mkdirSync(newDir);
                    let projects = this._store.get('projects');
                    if (projects) {
                        projects.push({
                            label: input,
                            description: newDir
                        });
                        this._store.set('projects', projects);
                    }
                    this.showInfo(`project ${input} create success`);
                }
            }
        },
            () => this.showError('create project failed'));
    }
    getProjects(): ProjectElement[] {
        let projects = this._store.get('projects');
        if (projects) {
            return projects;
        } else {
            let projectDir = this.getProjectPath();
            if (projectDir) {
                let ignoredFolders = this.config.get('ignoredFolders', []);
                let projects = fs.readdirSync(projectDir).filter(function (dir) {
                    return !dir.startsWith('.') && ignoredFolders.indexOf(dir) === -1 && fs.statSync(path.join(projectDir, dir)).isDirectory();
                }).map(function (dir) {
                    return {
                        label: dir,
                        description: path.join(projectDir, dir)
                    };
                });
                if (projects.length) {
                    this._store.set('projects', projects);
                    return projects;
                }
            } else {
                this.showError('Error loading project dir');
            }
        }
    }
    getProjectPath(): any {
        let projectsLocation: string = this.config.get<string>('projectsLocation');
        projectsLocation = projectsLocation ? this.replaceHome(projectsLocation) : path.join(this.homeDir, 'projects');
        try {
            let stats = fs.statSync(projectsLocation);
            if (stats.isDirectory()) {
                return projectsLocation;
            } else {
                this.showError('projectsLocation must be a folder');
            }
        } catch (error) {
            this.showError('projects.projectsLocation not exist');
        }
    }
    replaceHome(path: string): string {
        if (path.startsWith(this.homePathVariable)) {
            return path.replace(this.homePathVariable, this.homeDir);
        }
        return path;
    }
    showError(msg: string, option?: MessageItem): Thenable<any> {
        return window.showErrorMessage(msg, option);
    }
    showInfo(msg: string): void {
        window.showInformationMessage(msg);
    }
    dispose() {
        this._statusBarItem.dispose();
    }
    private _pickProject(selected?: ProjectElement) {
        if (!selected) {
            return;
        }
        let openInNewWindow: boolean = this.config.get('openInNewWindow', true);
        let url: Uri = Uri.file(selected.description);
        commands.executeCommand('vscode.openFolder', url, openInNewWindow).then(
            () => {},
            () => this.showInfo('Could not open the project!')
        );
    }
}