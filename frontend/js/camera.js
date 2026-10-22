import { AvatarStage } from "./avatar.js?v=singfeel2";

const stage = new AvatarStage(document.getElementById("stage"), { broadcast: "listen" });
stage.start();
