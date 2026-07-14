"use client";

import { useState } from "react";


interface Props {
  onSend: (message:string)=>void;
}


export default function ChatInput({
  onSend
}: Props) {


  const [input,setInput] = useState("");


  function handleSend(){

    if(!input.trim()){
      return;
    }


    onSend(input);

    setInput("");

  }


  return (
    <div
    className="
    flex
    gap-2
    "
    >

      <input
        className="
        flex-1
        border
        rounded
        px-3
        py-2
        "

        value={input}

        onChange={
          (e)=>setInput(e.target.value)
        }

        placeholder="Message Agent..."

      />


      <button
        className="
        bg-blue-500
        text-white
        px-4
        rounded
        "
        onClick={handleSend}
      >
        Send
      </button>


    </div>
  );

}