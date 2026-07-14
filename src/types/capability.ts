export type CapabilityKind =
  | "tool"
  | "mcp"
  | "skill";


export interface Capability {

  name:string;

  description:string;

  kind:CapabilityKind;


  provider:string;


  version:string;


  enabled:boolean;

}