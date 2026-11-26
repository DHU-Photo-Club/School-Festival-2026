import { mount } from "svelte";
import ArchiveHome from "./ArchiveHome.svelte";
import "../styles.css";

mount(ArchiveHome, { target: document.getElementById("app") as HTMLElement });
