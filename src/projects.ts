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
    private _projectDirs: string[]

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
            currentProjectPath = currentProjectPath.toLowerCase();
            let currentProject: ProjectElement = projects.find(project => project.description.toLowerCase() === currentProjectPath);
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
            let oldLocation = this.getProjectDirs();

            this.config = workspace.getConfiguration('projects');

            let newLocation = this.getProjectDirs(false);

            if (newLocation && newLocation !== oldLocation) {
                if (Array.isArray(newLocation) && Array.isArray(oldLocation)
                    && newLocation.length === oldLocation.length
                    && newLocation.sort().join(',') === oldLocation.sort().join(',')) {
                    return;
                }
                this.clearCache();
            }
        });
    }
    listProjects() {
        let projects: QuickPickItem[] = this.getProjects()
            .sort((p1, p2) => (p2.count - p1.count) || +(p1.label > p2.label))
            .concat([{
                label: '$reload',
                description: '重新加载项目列表',
                count: 0
            }]);
        let options = {
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
                if (projects.some(project => project.label === input)) {
                    return '该项目已经存在';
                }
            }
        };
        window.showInputBox(options).then(input => {
            if (input) {
                let projectDirs = this.getProjectDirs();
                if (projectDirs) {
                    if (projectDirs.length === 1) {
                        this.makeProjectDir(input, projectDirs[0]);
                    } else {
                        window.showQuickPick(projectDirs, {
                            placeHolder: '请选择项目文件夹',
                            matchOnDescription: false,
                            matchOnDetail: false
                        }).then(selected => {
                            this.makeProjectDir(input, selected.label);
                        });
                    }
                }
            }
        },
            e => this.showError(`创建项目失败：${e}`));
    }
    makeProjectDir(name: string, dir: string, ) {
        let projectDir = path.join(dir, name);
        fs.mkdirSync(projectDir);
        let projects = this._store.get('projects');
        let project: ProjectElement = {
            label: name,
            description: projectDir,
            count: 1
        };
        if (projects) {
            projects.push(project);
        } else {
            projects = [project];
        }
        this.setCache(projects);
        this.openProject(projectDir);
    }
    getProjects(): ProjectElement[] {
        let projects = this._store.get('projects');
        /**
         * @desc 兼容老版本，无count
         */
        if (projects) {
            return projects;
        } else {
            projects = [];
            let projectDirs = this.getProjectDirs();
            if (projectDirs) {
                let ignoredFolders = this.config.get('ignoredFolders', []);
                projectDirs.forEach(proDir => {
                    let pros = fs.readdirSync(proDir).filter(dir => {
                        if (dir.startsWith('.') || ignoredFolders.indexOf(dir) !== -1) return false;
                        try {
                            return fs.statSync(path.join(proDir, dir)).isDirectory();
                        } catch (e) {
                            return false;
                        }
                    }).map(dir => {
                        return {
                            label: dir,
                            description: path.join(proDir, dir),
                            count: this._getProjectCount(dir)
                        };
                    });
                    projects = projects.concat(pros);
                });
            }
            this.setCache(projects);
            return projects;
        }
    }
    getProjectDirs(cache = true) {
        if (cache && this._projectDirs) {
            return this._projectDirs;
        }

        let temp: string[] = [];
        let projectsLocation: string | string[] = this.config.get<string | string[]>('projectsLocation');

        if (Array.isArray(projectsLocation)) {
            temp = projectsLocation;
        } else if (projectsLocation) {
            temp.push(projectsLocation);
        }

        if (!temp.length) {
            this.showError('projects.projectsLocation 请配置项目目录');
            return;
        }

        let result = new Set();
        temp.forEach(dir => {
            let d = this.checkDir(dir.trim());
            if (d) {
                result.add(d);
            }
        });

        if (result.size) {
            return this._projectDirs = Array.from(result);
        } else {
            this.showError('projects.projectsLocation 项目目录必须为正确的文件夹');
        }
    }
    checkDir(dir: string): any {
        dir = this.replaceHome(dir);
        try {
            let stats = fs.statSync(dir);
            if (stats.isDirectory()) {
                return dir;
            } else {

            }
        } catch (error) {
        }
    }
    replaceHome(dir: string): string {
        return dir.startsWith(this.homePathVariable) ? dir.replace(this.homePathVariable, this.homeDir) : dir;
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
            let currentProject = this._projects.find(project => {
                return project.label === projectName;
            });
            if (currentProject && currentProject.count) {
                return currentProject.count;
            }
        }
        return 0;
    }
}