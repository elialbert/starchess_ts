import { OLD_UI } from "./ui/ui-switch";

// each look brings its own stylesheet, and the page stays hidden until one has
void (OLD_UI ? import("./old/old") : import("./main"));
