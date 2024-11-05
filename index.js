import WebSocket from "ws";
import dotenv from "dotenv"
import Fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const fastify = Fastify(); //instantiate fastify web framework
fastify.register(fastifyFormbody)
fastify.register(fastifyWs);

const SYSTEM_PROMPT = "Hello! You’re a friendly and engaging AI assistant designed to make users feel comfortable, entertained, and assisted over the phone. Here’s your personality and approach: 1. Tone and Style: Warm, friendly, slightly humorous, and conversational. Keep a relaxed tone and make people feel as if they're talking to a helpful friend. 2. Capabilities: Help: Offer assistance on any topic, from general knowledge to guidance on common tasks (like tech support, directions, tips on daily activities, etc.). Jokes and Fun: Feel free to share light-hearted jokes, respond playfully if the user seems in a good mood, and use fun facts to keep the conversation lively. Small Talk: If there’s a lull in the conversation, chat about general topics like the weather, fun facts, or trending topics in a friendly way. Personalization: If the user sounds stressed, aim to sound calm and reassuring; if they’re upbeat, match their energy. 3. Boundaries: Keep conversations respectful and positive. If the user requests something you can’t help with, politely let them know and suggest where they might get help. 4. Goals: The user should leave the call feeling either helped, entertained, or simply glad they had someone to chat with. Adapt to their needs and mood, whether they need help, a laugh, or just a friendly voice. Example Conversation Flow:1. Greet warmly: “Hey there! How’s it going today?” 2. React based on their mood: If they sound happy, you might say, “Sounds like someone’s having a great day! What’s the secret?”3.  Respond helpfully to questions but sprinkle in humor: If they need help with tech, you might say, “Ah, tech problems! It’s like our devices wait for the worst times to give us trouble, right?” 4. Keep the mood light and friendly: “Need anything else? Or maybe just a joke to make you smile";

const VOICE = 'alloy'
const PORT = 5050

const openaiws= new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
    headers:{
        "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
        "OpenAI-Beta": "realtime=v1",
    }
})

fastify.get("/", async (request, reply) => {
    reply.send({message : "Twilio Media Stream Server is running"})
})

//this route returns twiml which is a set of instructions for twilio to follow 
//also it contains connect tag which connect TwilioMediaStream for this call to websocket endpoint
fastify.all("/incoming-call", async (request, reply) => {

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
    <Say>
    Please wait while we connect you to an AI assistant powered by OpenAI Realtime API
    </Say>
    <Pause length = "1"/>
    <Say>
    You can start talking now
    </Say>
    <Connect>
    <Stream url="wss://${request.headers.host}/media-stream"/>
    </Connect>
    </Response>
    `;
})

fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Client connected')
        
        let streamSid = null

        //here is the session update object that will be sent whenever the websocket connection is established to configure the openai session
        const sendSessionUpdate = () => {
            const sessionUpdate = {
                type: "session.update",
                session:{
                    turn_detection :{type : "server_vad"},
                    input_audio_format : "g711_ulaw",
                    output_audio_format : "g711_ulaw",
                    voice:VOICE,
                    instructions: SYSTEM_PROMPT,
                    modalities: ["text", "voice"],
                    temperature: 0.8, //controls randomness within the assistant
                }
            }
        
            console.log("Sending session update", JSON.stringify(sessionUpdate))
            openaiws.send(JSON.stringify(sessionUpdate))
        
        };

        openaiws.on('open', () => {
            console.log("Connected to openai realtime api")
            setTimeout(sendSessionUpdate, 1000) 
        
        })

        //we receive the audio from openai and sending it to Twiliomedia stream and send back to the user

        openaiws.on('message',(data)=>{
            try{
                const response = JSON.parse(data)
                if(response.type === "session.update")
                    console.log("Received session update", response)

                if(response.type === "response.audio.delta" && response.delta){
                    const audioDelta = {
                        event :"media",
                        streamSid : streamSid,
                        media : {
                            payload : Buffer.from(response.delta, "base64").toString("base64")
                        }
                    }
                    connection.send(JSON.stringify(audioDelta))
                }
            }catch(error){
                console.error("error processing openai message:",error,"data:",data)
            }
        });

        connection.on('message', (message) => {
            try{
                const data = JSON.parse(message)

                switch(data.event){
                    case "start":
                        streamSid = data.start.streamSid
                        console.log("incoming stream has started", streamSid)
                        break;

                    case "media":
                        if(openaiws.readyState === WebSocket.OPEN){
                            const audioAppend = {
                                type : "input_audio_buffer.append",
                                audio:  data.media.payload
                            }
                            openaiws.send(JSON.stringify(audioAppend))
                        }
                        break;
                        default:
                            console.log("Non-media event", data.event)
                }}
                catch(error){
                    console.error(error)

                } 
                
        })

        connection.on('close',()=>{
            if(openaiws.readyState === WebSocket.OPEN){
                openaiws.close()
                console.log("Client disconnected")
            }
        })

        openaiws.on('close',()=>{
            console.log("Openai connection closed")
        })

        openaiws.on('error',(error)=>{
            console.error("Openai connection error", error)
        })
 

    })

    
})

fastify.listen({port : PORT}, (err) => {
    if(err){
       console.error(err)
        process.exit(1)
    }
    console.log(`Server running on port ${PORT}`)
})


