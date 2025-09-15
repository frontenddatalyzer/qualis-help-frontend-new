import { Injectable, signal } from "@angular/core";

@Injectable({
    providedIn: 'root'
})

export class GlobalService {
    dataLoaded = signal(false);

    isLoaded() {
        return this.dataLoaded();
    }

    markLoaded() {
        this.dataLoaded.set(true);
    }

    resetLoader() {
        this.dataLoaded.set(false);
    }
}