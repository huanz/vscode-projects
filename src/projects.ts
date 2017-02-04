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

interface ProjectElement extends QuickPickItem {
    count: number
}

export default class Projects {
    homePathVariable: string = '$home'
    homeDir: string = os.homedir()

    context: ExtensionContext
    config: WorkspaceConfiguration

    private _statusBarItem: StatusBarItem
    private _store: Store
    private _projects: ProjectElement[]

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
            let currentProject: ProjectElement = projects.find(project => project.description.toString().toLowerCase() === currentProjectPath);
            if (currentProject) {
                this._statusBarItem.text += currentProject.label;
                this._statusBarItem.show();
                currentProject.count++;
                this.setCache(projects);
            }
        }
    }
    registerCommands(): void {
        this.context.subscriptions.push(commands.registerCommand('projects.list', () => this.listProjects()));
        this.context.subscriptions.push(commands.registerCommand('projects.reload', () => this.reloadProjects()));
        this.context.subscriptions.push(commands.registerCommand('projects.create', () => this.createProject()));

        workspace.onDidChangeConfiguration(() => {
            let oldLocation: string = this.config.get<string>('projectsLocation');
            let newLocation: string;

            this.config = workspace.getConfiguration('projects');
            newLocation = this.config.get<string>('projectsLocation');

            if (newLocation !== oldLocation) {
                this.clearCache();
            }
        });
    }
    listProjects() {
        let projects: Promise<QuickPickItem[]> = new Promise((resolve, reject) => {
            resolve(this.getProjects()
                .sort((p1, p2) => (p2.count - p1.count) || +(p1.label > p2.label))
                .concat([{
                    label: '$reload',
                    description: '重新加载项目列表',
                    count: 0
                }])
            );
        });
        let options = <QuickPickOptions>{
            placeHolder: '输入项目名打开该项目',
            matchOnDescription: false,
            matchOnDetail: false
        };

        window.showQuickPick(projects, options).then(
            selected => this._pickProject(selected),
            e => this.showInfo(`加载项目失败: ${e}`)
        );
    }
    reloadProjects() {
        this.clearCache().then(() => this.listProjects());
    }
    createProject() {
        let options = <InputBoxOptions>{
            prompt: '请输入项目名',
            placeHolder: '请输入项目名',
            validateInput: (input) => {
                if (!input.trim()) {
                    return '项目名不能为空';
                }
                let projects = this.getProjects();
                if (projects && projects.some(project => project.label === input)) {
                    return '该项目已经存在';
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
                            description: newDir,
                            count: 0
                        });
                        this.setCache(projects);
                    }
                    this.openProject(newDir);
                }
            }
        },
        e => this.showError(`创建项目失败：${e}`));
    }
    getProjects(): ProjectElement[] {
        let projects = this._store.get('projects');
        /**
         * @desc 兼容老版本，无count
         */
        if (projects && typeof projects[0].count !== 'undefined') {
            return projects;
        } else {
            let projectDir = this.getProjectPath();
            if (projectDir) {
                let ignoredFolders = this.config.get('ignoredFolders', []);
                let projects = fs.readdirSync(projectDir).filter(dir => {
                    return !dir.startsWith('.') && ignoredFolders.indexOf(dir) === -1 && fs.statSync(path.join(projectDir, dir)).isDirectory();
                }).map(dir => {
                    return {
                        label: dir,
                        description: path.join(projectDir, dir),
                        count: this._getProjectCount(dir)
                    };
                });
                if (projects.length) {
                    this.setCache(projects);
                    return projects;
                }
            } else {
                this.showError('项目目录加载出错');
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
                this.showError('projects.projectsLocation 必须是一个目录');
            }
        } catch (error) {
            this.showError('projects.projectsLocation 不存在');
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
    setCache(projects: ProjectElement[]): void {
        this._store.set('projects', projects);
    }
    clearCache(): Thenable<void> {
        /**
         * @desc 缓存老的projects
         */
        this._projects = this._store.get('projects');
        return this._store.clear('projects');
    }
    openProject(projectPath: string) {
        let openInNewWindow: boolean = this.config.get('openInNewWindow', false);
        let url: Uri = Uri.file(projectPath);
        commands.executeCommand('vscode.openFolder', url, openInNewWindow).then(
            () => { },
            e => this.showInfo(`项目目录打开失败：${e}`)
        );
    }
    dispose() {
        this._statusBarItem.dispose();
    }
    private _pickProject(selected?: QuickPickItem) {
        if (!selected) {
            return;
        }
        /**
         * @desc 快捷重新加载项目
         */
        if (selected.label === '$reload') {
            this.reloadProjects();
        } else {
            this.openProject(selected.description);
        }
    }
    private _getProjectCount(projectName: string): number {
        if (this._projects) {
            return this._projects.find(project => {
                return project.label === projectName;
            }).count || 0;
        }
        return 0;
    }
}