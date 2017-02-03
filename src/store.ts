'use strict';
import {
    ExtensionContext
} from 'vscode';

export default class Store {
    private _context: ExtensionContext
    private _namespace: string
    private _cache: Object
    constructor(context: ExtensionContext, namespace: string = 'cache') {
        this._context = context;
        this._namespace = namespace;
        this._cache = context.globalState.get(this._namespace, {});
    }
    set(key: string | Object, value): Thenable<void> {
        if (typeof key === 'string') {
            this._cache[key] = value;
        } else {
            for (let prop in key) {
                this._cache[prop] = key[prop];
            }
        }
        return this._update();
    }
    get(key: string) {
        return this._cache[key];
    }
    clear(key?: string): Thenable<void> {
        if (key) {
            delete this._cache[key];
        } else {
            this._cache = {};
        }
        return this._update();
    }
    private _update(): Thenable<void> {
        return this._context.globalState.update(this._namespace, this._cache);
    }
}