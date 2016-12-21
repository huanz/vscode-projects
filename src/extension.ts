'use strict';
import * as vscode from 'vscode';
import Projects from './projects';

export function activate(context: vscode.ExtensionContext): void {
    new Projects(context);
}