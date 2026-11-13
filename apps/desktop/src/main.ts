import { App } from "./app/App";

const root = document.getElementById("app");
if (root) void new App(root).start();
