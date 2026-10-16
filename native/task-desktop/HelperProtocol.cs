using System.Text.Json.Nodes;

namespace WinPilotTaskDesktop;

// The PowerShell daemon uses Int32 request IDs. The outer worker protocol uses
// opaque string IDs; translate at this boundary without changing caller IDs.
sealed class HelperProtocol(TextWriter input,TextReader output)
{
    int sequence;
    internal async Task<JsonObject> Invoke(JsonObject request)
    {
        int id=checked(++sequence);
        var message=request.DeepClone().AsObject();message["id"]=id;
        await input.WriteLineAsync(message.ToJsonString(new System.Text.Json.JsonSerializerOptions{Encoder=System.Text.Encodings.Web.JavaScriptEncoder.Default}));
        await input.FlushAsync();
        string? line;
        while((line=await output.ReadLineAsync())!=null) {
            JsonObject? result;
            try{result=JsonNode.Parse(line) as JsonObject;}catch(System.Text.Json.JsonException){continue;}
            if(result?["id"]?.ToString()!=id.ToString(System.Globalization.CultureInfo.InvariantCulture))continue;
            result!["id"]=request["id"]?.DeepClone();return result;
        }
        throw new IOException("独立桌面执行工具已退出，未返回当前请求的响应。");
    }
}
