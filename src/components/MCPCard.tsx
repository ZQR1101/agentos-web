import { MCPServer } from "@/types/mcp";


interface Props {

 server:MCPServer;

}


export default function MCPCard({
 server
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
{server.name}
</h2>


<p>
{server.description}
</p>


<p>
Status:
{server.status}
</p>


<h3>
Tools:
</h3>


<ul>

{
server.tools.map(tool=>(

<li
key={tool}
>
{tool}
</li>

))
}

</ul>


</div>

)

}