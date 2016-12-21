'use strict';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const {
    window,
    workspace,
    commands,
    StatusBarAlignment
} = vscode;

interface ProjectElement {
    name: string,
    path: string
}

export default class Projects {
    private homePathVariable: string = '$home'
    public homeDir: string = os.homedir()

    private context: vscode.ExtensionContext
    private config: vscode.WorkspaceConfiguration = workspace.getConfiguration('projects')

    public constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.registerCommands();
        this.showStatusBar();
    }
    public showStatusBar(): void {
        let showStatusBar = this.config.get('showProjectNameInStatusBar');
        let currentProjectPath = workspace.rootPath;
        if (showStatusBar && currentProjectPath) {
            let statusItem: vscode.StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
            statusItem.text = '$(file-directory) ';
            statusItem.tooltip = currentProjectPath;
            statusItem.command = 'projects.list';

            let projects: ProjectElement[] = this.getProjects();
            currentProjectPath = currentProjectPath.toString().toLowerCase();
            let currentProject: ProjectElement = projects.find((project) => project.path.toString().toLowerCase() === currentProjectPath);
            if (currentProject) {
                statusItem.text += currentProject.name;
                statusItem.show();
            }
        }
    }
    public registerCommands(): void {
        this.context.subscriptions.push(commands.registerCommand('projects.list', () => this.listProjects));
    }
    public listProjects() {
        let projects: ProjectElement[] = this.getProjects();
        let options = <vscode.QuickPickOptions>{
            placeHolder: 'Loading Projects (pick one to open)',
            matchOnDescription: false,
            matchOnDetail: false
        };

        window.showQuickPick(projects, options).then(
            selected => this.pickProject(selected),
            () => this.showInfo('Error loading projects: ${reason}')
        );
    }
    private pickProject(selected?: ProjectElement) {
        if (!selected) {
            return;
        }
        let openInNewWindow: boolean = this.config.get('openInNewWindow', true);
        let uri: vscode.Uri = vscode.Uri.file(selected.path);
        commands.executeCommand('vscode.openFolder', uri, openInNewWindow)
            .then(
                value => ({}),
                value => this.showInfo('Could not open the project!')
            );
    }
    public getProjects(): ProjectElement[] {
        let projectDir = this.getProjectPath();
        if (projectDir) {
            let ignoredFolders = this.config.get('ignoredFolders', []);
            return fs.readdirSync(projectDir).filter(function (dir) {
                return !dir.startsWith('.') && ignoredFolders.indexOf(dir) === -1 && fs.statSync(path.join(projectDir, dir)).isDirectory();
            }).map(function (dir) {
                return {
                    name: dir,
                    path: path.join(projectDir, dir)
                };
            });
        } else {
            this.showError('Error loading project dir');
        }
    }
    public getProjectPath(): any {
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
    public replaceHome(path: string): string {
        if (path.startsWith(this.homePathVariable)) {
            return path.replace(this.homePathVariable, this.homeDir);
        }
        return path;
    }
    public showError(msg: string, option?: vscode.MessageItem): Thenable<any> {
        return window.showErrorMessage(msg, option);
    }
    public showInfo(msg: string): void {
        window.showInformationMessage(msg);
    }
}