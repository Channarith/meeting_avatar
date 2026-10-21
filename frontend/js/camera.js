import { AvatarStage } from "./avatar.js?v=ace1";

const stage = new AvatarStage(document.getElementById("stage"), { broadcast: "listen" });
stage.start();
