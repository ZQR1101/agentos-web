import { AgentTool } from "@/types/tool";


interface Props {

 tool:AgentTool;

}


export default function ToolCard({
 tool
}:Props){


return (

<div
className="
border
rounded
p-4
"
>


<h2>
{tool.name}
</h2>


<p>
{tool.description}
</p>


<p>
Type:
{tool.type}
</p>


<p>
Risk:
{tool.risk}
</p>


<p>
{
 tool.requireApproval
 ? "Approval Required"
 : "No Approval"
}
</p>


<p>
Status:
{
 tool.enabled
 ? "Enabled"
 : "Disabled"
}
</p>


</div>

)

}