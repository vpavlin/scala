import "react-native-get-random-values"; // entropy polyfill for keycard-sdk (Hermes) — must load first
import "react-native-gesture-handler";    // must be imported before anything uses gestures
import { registerRootComponent } from "expo";
import App from "./App";
registerRootComponent(App);
