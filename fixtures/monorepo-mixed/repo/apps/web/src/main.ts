import { createElement } from "react";
import { checkout } from "./checkout";

export const page = createElement("div", { dangerouslySetInnerHTML: { __html: checkout("Cart", 9.5) } });
