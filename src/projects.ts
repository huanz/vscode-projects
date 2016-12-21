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

    public constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.registerCommands();
        this.showStatusBar();
    }
    public showStatusBar(): void {
        let showStatusBar = workspace.getConfiguration('projectManager').get('showProjectNameInStatusBar');
        let currentProjectPath = workspace.rootPath;
        if (showStatusBar && currentProjectPath) {
            let statusItem: vscode.StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
            statusItem.text = '$(file-directory) ';
            statusItem.tooltip = currentProjectPath;
            statusItem.command = 'projects.list';

            let projects: ProjectElement[] = this.loadProjects();
            currentProjectPath = currentProjectPath.toString().toLowerCase();
            let currentProject:ProjectElement = projects.find((project) => project.path.toString().toLowerCase() === currentProjectPath);
            if (currentProject) {
	            statusItem.text += currentProject.name;
	            statusItem.show();
	        }
        }
    }
    public registerCommands(): void {
        this.context.subscriptions.push(commands.registerCommand('projects.list', () => this.loadProjects));
        
    }
    public loadProjects(): ProjectElement[] {
        return [];
    }
    public getProjectPath(): any {
        let projectsLocation: string = workspace.getConfiguration('projectManager').get<string>('projectsLocation');
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
}