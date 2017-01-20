'use strict';
import { ExtensionContext } from 'vscode';
import Projects from './projects';

export function activate(context: ExtensionContext): void {
    new Projects(context);
}